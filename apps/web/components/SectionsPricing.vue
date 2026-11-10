<script setup lang="ts">
/**
 * Section VII — "Pricing that shows the meter" (design.md §3.10): plan table,
 * the interactive estimator, a usage example, FAQ, and the final CTA.
 */
import type { RateCardPublic } from "~/types/observatory";

const { api } = useApi();
const rateCard = ref<RateCardPublic | null>(null);

onMounted(async () => {
  try {
    rateCard.value = await api<RateCardPublic>("GET", "/v1/public/rate-card");
  } catch {
    rateCard.value = null;
  }
});

const faqs = [
  {
    q: "Are these real people?",
    a: "No. CrowdLens models synthetic agents grounded in your source documents. Outputs are hypotheses for scenario exploration, never measurements of real audiences.",
  },
  {
    q: "Does one million agents mean one million LLM calls?",
    a: "No. A bounded, stratified subset reasons directly with provider models; cohort propagation carries the effects to the full logical population. You are billed per reasoning call, not per agent.",
  },
  {
    q: "Can I switch between Gemini and OpenRouter?",
    a: "For new runs, yes — provider and model are chosen at run creation and pinned in the run manifest. Existing runs stay pinned to the provider they started with.",
  },
  {
    q: "How do credits work?",
    a: "Estimate, reserve, settle actual, release remainder. Before you confirm a run you see an estimate range and a hard cap; the reservation holds the cap, you are debited the actual usage, and the remainder is released immediately.",
  },
  {
    q: "Is this a guaranteed prediction?",
    a: "No. Synthetic populations surface objections and narratives worth testing. Use real-world validation before high-stakes decisions.",
  },
  {
    q: "What happens to my documents?",
    a: "They are stored in your tenant-scoped object storage with hash-verified uploads, reused only within your workspace via content-addressed parsing, and purged when you delete the project. Provider calls follow the data policy you configure (data_collection: deny by default).",
  },
  {
    q: "Is the source available?",
    a: "Yes. CrowdLens ships under the AGPL with a visible source link in the footer — the selected licensing route is an open fork with a source offer, not a closed SaaS black box.",
  },
];

const openFaq = ref<number | null>(0);

const meterSteps = [
  { label: "Estimate", value: "134–234 credits", note: "shown before you confirm" },
  { label: "Reservation", value: "200 credits held", note: "the hard cap, locked in your wallet" },
  { label: "Actual debit", value: "132 credits", note: "rated from durable usage records" },
  { label: "Released", value: "68 credits", note: "remainder returned at settlement" },
];
</script>

<template>
  <section id="pricing" class="section-frame" aria-labelledby="pricing-heading">
    <p class="section-eyebrow">Section VII</p>
    <h2 id="pricing-heading" class="section-title">Pricing that shows the meter</h2>

    <div v-if="rateCard" class="plan-table surface table-scroll">
      <table class="table-plain">
        <caption class="visually-hidden">Plan comparison</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Price</th>
            <th scope="col">Included credits</th>
            <th scope="col">Agent ceiling</th>
            <th scope="col">Seats</th>
            <th scope="col">Concurrent runs</th>
            <th scope="col">Active projects</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plan in rateCard.plans" :key="plan.code">
            <td>{{ plan.name }}</td>
            <td>{{ plan.price_minor === 0 ? "Free" : `₹${(plan.price_minor / 100).toLocaleString()}/mo` }}</td>
            <td>{{ plan.included_credits.toLocaleString() }}</td>
            <td>{{ plan.agent_ceiling.toLocaleString() }}</td>
            <td>{{ plan.seats }}</td>
            <td>{{ plan.max_concurrent_runs }}</td>
            <td>{{ plan.max_active_projects }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="estimator-block">
      <h3>Simulation credit estimator</h3>
      <CreditEstimator />
    </div>

    <div class="meter-example surface" aria-label="How a run meters credits">
      <p class="mono-label">One illustrative run, start to settle</p>
      <ol class="meter-steps">
        <li v-for="step in meterSteps" :key="step.label">
          <p class="mono-label">{{ step.label }}</p>
          <p class="meter-value">{{ step.value }}</p>
          <p class="meter-note">{{ step.note }}</p>
        </li>
      </ol>
    </div>
  </section>

  <section id="faq" class="section-frame" aria-labelledby="faq-heading">
    <p class="section-eyebrow">FAQ</p>
    <h2 id="faq-heading" class="section-title">Questions, answered plainly</h2>
    <div class="faq-list">
      <div v-for="(item, index) in faqs" :key="item.q" class="faq-item surface">
        <button
          type="button"
          class="faq-question"
          :aria-expanded="openFaq === index"
          @click="openFaq = openFaq === index ? null : index"
        >
          {{ item.q }}
          <span aria-hidden="true">{{ openFaq === index ? "−" : "+" }}</span>
        </button>
        <p v-if="openFaq === index" class="faq-answer">{{ item.a }}</p>
      </div>
    </div>
  </section>

  <section class="final-cta section-frame" aria-labelledby="final-cta-heading">
    <h2 id="final-cta-heading" class="final-heading">Bring the decision.<br />We’ll bring the crowd.</h2>
    <div class="final-actions">
      <NuxtLink to="/app" class="final-button">Run a scenario</NuxtLink>
      <NuxtLink to="/sample-report" class="final-link">Read the methodology →</NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 18ch;
}
.plan-table {
  margin-top: var(--space-8);
  padding: var(--space-2);
}
.estimator-block {
  margin-top: var(--space-12);
}
.estimator-block h3 {
  font-size: 1.4rem;
  margin-bottom: var(--space-4);
}
.meter-example {
  margin-top: var(--space-12);
  padding: var(--space-6);
}
.meter-steps {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}
@media (max-width: 900px) {
  .meter-steps {
    grid-template-columns: 1fr 1fr;
  }
}
.meter-value {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 600;
  margin: var(--space-1) 0;
}
.meter-note {
  color: var(--color-text-secondary);
  font-size: 0.88rem;
  margin: 0;
}
.faq-list {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-8);
  max-width: 900px;
}
.faq-question {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  background: transparent;
  border: none;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
  text-align: start;
  padding: var(--space-4);
  cursor: pointer;
}
.faq-answer {
  padding: 0 var(--space-4) var(--space-4);
  color: var(--color-text-secondary);
  margin: 0;
}
.final-cta {
  text-align: start;
}
.final-heading {
  font-size: clamp(2.4rem, 5vw, 5rem);
  font-weight: 600;
  max-width: 20ch;
}
.final-actions {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
  margin-top: var(--space-6);
}
.final-button {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-control);
  font-size: 1.05rem;
}
.final-button:hover {
  text-decoration: none;
  filter: brightness(1.08);
}
.final-link {
  font-size: 1.05rem;
}
</style>
