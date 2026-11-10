<script setup lang="ts">
/**
 * Simulation credit estimator (design.md §3.10). Rates come from the public
 * rate-card endpoint and mirror the server-side estimateCredits formula in
 * billing/catalog.ts (ACTION_BATCH = 8). Values are indicative; the
 * authoritative estimate is computed per run by the API.
 */
import type { RateCardPublic } from "~/types/observatory";

const props = defineProps<{ compact?: boolean }>();

const { api } = useApi();
const rateCard = ref<RateCardPublic | null>(null);
const loadError = ref("");

const pages = ref(5);
const population = ref(100_000);
const activeBudget = ref(256);
const ticks = ref(24);
const reportDepth = ref<"standard" | "detailed">("standard");
const provider = ref("gemini");

onMounted(async () => {
  try {
    rateCard.value = await api<RateCardPublic>("GET", "/v1/public/rate-card");
  } catch (error) {
    loadError.value = (error as Error).message;
  }
});

const estimate = computed(() => {
  const card = rateCard.value;
  if (!card) return null;
  const e = card.estimator;
  const factor = e.provider_multiplier[provider.value] ?? 10;
  const prep = Math.ceil(population.value / 5000) * factor;
  const perTick =
    Math.ceil(activeBudget.value / e.action_batch) * e.active_reasoning_call * factor +
    Math.ceil(population.value / 50_000) * e.population_tick_per_thousand;
  const tickCredits = perTick * ticks.value;
  const graph = Math.max(1, Math.ceil(pages.value / 5)) * 5 * e.graph_chunk;
  const report = (reportDepth.value === "detailed" ? 20 : 8) * e.report_section;
  const base = prep + tickCredits + graph + report;
  const drivers = [
    { factor: "population preparation", credits: prep },
    { factor: `${ticks.value} ticks (active reasoning + cohort propagation)`, credits: tickCredits },
    { factor: "source graph extraction", credits: graph },
    { factor: `report generation (${reportDepth.value})`, credits: report },
  ].sort((a, b) => b.credits - a.credits);
  const low = Math.ceil(base * e.low_factor);
  const high = Math.ceil(base * e.high_factor);
  return { low, high, cap: Math.max(1, Math.ceil(high * 1.25)), drivers };
});

const planRecommendation = computed(() => {
  if (!rateCard.value || !estimate.value) return "";
  const needed = estimate.value.high;
  const fits = rateCard.value.plans.filter((p) => p.included_credits >= needed);
  return fits.length ? fits[0]!.code : "business";
});
</script>

<template>
  <div class="estimator surface">
    <div v-if="loadError" class="estimator-error" role="alert">
      Rate card unavailable ({{ loadError }}). Estimates are disabled until the API is reachable.
    </div>
    <template v-else-if="rateCard">
      <div class="estimator-grid">
        <div class="estimator-inputs">
          <label>
            Document pages
            <input v-model.number="pages" type="number" min="1" max="500" />
          </label>
          <label>
            Logical population
            <select v-model.number="population">
              <option :value="10_000">10,000</option>
              <option :value="50_000">50,000</option>
              <option :value="100_000">100,000</option>
              <option :value="500_000">500,000</option>
              <option :value="1_000_000">1,000,000</option>
            </select>
          </label>
          <label>
            Active-reasoning budget (agents)
            <input v-model.number="activeBudget" type="number" min="16" max="100_000" step="8" />
          </label>
          <label>
            Ticks
            <input v-model.number="ticks" type="range" min="1" max="200" />
            <span class="mono-label">{{ ticks }} ticks</span>
          </label>
          <label>
            Report depth
            <select v-model="reportDepth">
              <option value="standard">standard</option>
              <option value="detailed">detailed</option>
            </select>
          </label>
          <label>
            Provider / model class
            <select v-model="provider">
              <option v-for="(mult, id) in rateCard.estimator.provider_multiplier" :key="id" :value="id">
                {{ id }} (×{{ mult }})
              </option>
            </select>
          </label>
        </div>
        <div class="estimator-output" aria-live="polite">
          <p class="mono-label">Estimated range (rate card {{ rateCard.rate_card_version }})</p>
          <p class="estimate-band">
            {{ estimate!.low.toLocaleString() }} – {{ estimate!.high.toLocaleString() }} credits
          </p>
          <p class="estimate-cap">Hard cap at run creation: {{ estimate!.cap.toLocaleString() }} credits</p>
          <ul class="estimate-drivers">
            <li v-for="driver in estimate!.drivers" :key="driver.factor">
              <span>{{ driver.factor }}</span>
              <span class="mono-label">{{ driver.credits.toLocaleString() }}</span>
            </li>
          </ul>
          <p class="estimate-plan mono-label">
            Plan that covers the high estimate: {{ planRecommendation }}
          </p>
          <p class="mono-label">{{ rateCard.disclaimer }}</p>
        </div>
      </div>
    </template>
    <p v-else class="estimator-loading" role="status">Loading rate card…</p>
  </div>
</template>

<style scoped>
.estimator {
  padding: var(--space-6);
}
.estimator-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-8);
}
@media (max-width: 900px) {
  .estimator-grid {
    grid-template-columns: 1fr;
  }
}
.estimator-inputs {
  display: grid;
  gap: var(--space-4);
}
.estimator-output {
  border-inline-start: 1px solid var(--color-border);
  padding-inline-start: var(--space-8);
}
@media (max-width: 900px) {
  .estimator-output {
    border-inline-start: none;
    padding-inline-start: 0;
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }
}
.estimate-band {
  font-family: var(--font-display);
  font-size: clamp(1.8rem, 3vw, 2.6rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  margin: var(--space-2) 0;
}
.estimate-cap {
  color: var(--color-text-secondary);
  margin-bottom: var(--space-4);
}
.estimate-drivers {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
}
.estimate-drivers li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.92rem;
}
.estimator-error,
.estimator-loading {
  color: var(--color-text-secondary);
}
.estimator-error {
  color: var(--color-danger);
}
</style>
