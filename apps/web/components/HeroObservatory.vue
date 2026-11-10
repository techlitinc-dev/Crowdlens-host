<script setup lang="ts">
/**
 * Hero observatory (design.md §3.3): fixture-driven, labelled ILLUSTRATIVE
 * SAMPLE, with provider control, tick scrubber, evidence rail, and the
 * loading / fixture-error / canvas-unavailable / reduced-motion states.
 */
import fixtureJson from "~/fixtures/observatory.json";
import type { ObservatoryFixture } from "~/types/observatory";

const fixture = fixtureJson as unknown as ObservatoryFixture;

const tick = ref(fixture.scenario.default_tick);
const selectedSegmentId = ref<string | null>(fixture.scenario.segments[0]!.id);
const providerId = ref(fixture.providers[0]!.id);
const loadState = ref<"loading" | "ready" | "error">("loading");

const reducedMotion = ref(false);
onMounted(() => {
  reducedMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Simulate fixture fetch: the fixture is bundled, but the state machine is
  // real so a broken deploy surfaces the fixture-error state.
  try {
    if (!fixture.fixture_version) throw new Error("missing fixture_version");
    loadState.value = "ready";
  } catch {
    loadState.value = "error";
  }
});

const selectedSegment = computed(
  () => fixture.scenario.segments.find((s) => s.id === selectedSegmentId.value) ?? null,
);
const provider = computed(() => fixture.providers.find((p) => p.id === providerId.value)!);

const stanceAtTick = (segmentId: string, t: number): number => {
  const series = fixture.segment_ticks[segmentId] ?? {};
  const ticks = Object.keys(series).map(Number).sort((a, b) => a - b);
  let value = 0;
  for (const k of ticks) {
    if (k <= t) value = series[String(k)]!;
  }
  return value;
};

const selectedEvent = computed(() => {
  const events = fixture.events
    .filter((e) => e.segment === selectedSegmentId.value && e.tick <= tick.value)
    .sort((a, b) => b.tick - a.tick);
  return events[0] ?? null;
});

const seriesAtTick = computed(() => {
  const points = fixture.timeline.filter((p) => p.tick <= tick.value);
  return points[points.length - 1] ?? fixture.timeline[0]!;
});

const credits = computed(() => {
  const base = fixture.credit_model.base_per_tick * tick.value;
  return Math.round(base * provider.value.credit_rate);
});

const stanceLabel = (value: number): string => {
  if (value <= -0.4) return "strongly sceptical";
  if (value < -0.1) return "sceptical";
  if (value < 0.1) return "uncertain";
  if (value < 0.4) return "supportive";
  return "strongly supportive";
};

const timelinePath = (key: "adoption" | "support" | "objection" | "uncertainty") => {
  const points = fixture.timeline;
  const maxTick = points[points.length - 1]!.tick;
  return points
    .map((p, i) => {
      const x = (p.tick / maxTick) * 100;
      const y = 40 - p[key] * 36 + (key === "support" ? 0 : key === "adoption" ? 2 : key === "objection" ? 4 : 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};
</script>

<template>
  <section class="observatory surface" aria-label="Synthetic population observatory — illustrative sample">
    <p class="illustrative mono-label">{{ fixture.label }} — not live customer data</p>

    <div v-if="loadState === 'loading'" class="observatory-state" role="status">
      Loading observatory fixture…
    </div>

    <div v-else-if="loadState === 'error'" class="observatory-state observatory-error" role="alert">
      The observatory fixture could not be loaded. The summary below remains available.
      <p class="observatory-summary-fallback">
        Five audience communities react to the launch announcement; the cost-sensitive
        SME segment is the largest sceptical group, and finance reviewers exert
        outsized influence despite their small share.
      </p>
    </div>

    <template v-else>
      <!-- Top bar -->
      <div class="observatory-topbar">
        <div>
          <p class="mono-label">Scenario</p>
          <p class="topbar-value">{{ fixture.scenario.name }}</p>
        </div>
        <div>
          <p class="mono-label">State</p>
          <p class="topbar-value">TICK {{ tick }} / {{ fixture.scenario.total_ticks }}</p>
        </div>
        <fieldset class="provider-control">
          <legend class="mono-label">Provider</legend>
          <div class="segmented">
            <button
              v-for="p in fixture.providers"
              :key="p.id"
              type="button"
              class="segmented-option"
              :class="{ active: providerId === p.id }"
              :aria-pressed="providerId === p.id"
              @click="providerId = p.id"
            >
              {{ p.label }}
            </button>
          </div>
        </fieldset>
        <div class="population-label">
          <p class="mono-label">Population</p>
          <p class="topbar-value">
            {{ fixture.scenario.logical_population.toLocaleString() }} logical ·
            {{ fixture.scenario.active_reasoning.toLocaleString() }} active reasoning
          </p>
        </div>
      </div>

      <div class="observatory-body">
        <!-- Canvas / poster -->
        <div class="observatory-canvas-pane">
          <ObservatoryCanvas
            :fixture="fixture"
            :tick="tick"
            :selected-segment="selectedSegmentId"
            :reduced-motion="reducedMotion"
            @select="selectedSegmentId = $event"
          >
            <template #poster>
              <div class="canvas-poster" role="img" aria-label="Static map of five audience communities">
                <svg viewBox="0 0 100 60" aria-hidden="true">
                  <g v-for="(segment, i) in fixture.scenario.segments" :key="segment.id">
                    <circle
                      :cx="20 + (i % 3) * 30"
                      :cy="16 + Math.floor(i / 3) * 26"
                      :r="6 + segment.share * 10"
                      fill="none"
                      stroke="rgba(133,192,147,0.5)"
                      stroke-width="0.6"
                    />
                    <circle
                      :cx="20 + (i % 3) * 30"
                      :cy="16 + Math.floor(i / 3) * 26"
                      r="1.6"
                      :fill="segment.active_share > 0.3 ? 'var(--color-action)' : 'rgba(244,236,216,0.6)'"
                    />
                  </g>
                </svg>
                <p class="mono-label">Canvas unavailable — static community map shown.</p>
              </div>
            </template>
          </ObservatoryCanvas>

          <!-- Keyboard-operable segment list (same inspection as the lens). -->
          <div class="segment-chips" role="group" aria-label="Select a segment to inspect">
            <button
              v-for="segment in fixture.scenario.segments"
              :key="segment.id"
              type="button"
              class="segment-chip"
              :class="{ active: selectedSegmentId === segment.id }"
              :aria-pressed="selectedSegmentId === segment.id"
              @click="selectedSegmentId = segment.id"
            >
              {{ segment.name }}
            </button>
          </div>
        </div>

        <!-- Evidence rail -->
        <aside class="evidence-rail" aria-live="polite">
          <template v-if="selectedSegment">
            <h3>{{ selectedSegment.name }}</h3>
            <p class="stance" :data-stance="stanceAtTick(selectedSegment.id, tick) >= 0 ? 'support' : 'object'">
              {{ stanceLabel(stanceAtTick(selectedSegment.id, tick)) }}
              <span class="mono-label">stance Δ {{ stanceAtTick(selectedSegment.id, tick).toFixed(2) }} · t{{ tick }}</span>
            </p>
            <p>{{ selectedSegment.summary }}</p>

            <div class="evidence-item">
              <p class="mono-label">Source · {{ selectedSegment.source_excerpt.locator }}</p>
              <blockquote>{{ selectedSegment.source_excerpt.text }}</blockquote>
            </div>
            <div v-if="selectedEvent" class="evidence-item">
              <p class="mono-label">{{ selectedEvent.provenance }} · tick {{ selectedEvent.tick }}</p>
              <p>{{ selectedEvent.label }}</p>
            </div>
            <div class="evidence-item">
              <p class="mono-label">LLM-generated · direct agent</p>
              <blockquote>“{{ selectedSegment.agent_quote }}”</blockquote>
            </div>
          </template>
        </aside>
      </div>

      <!-- Bottom timeline -->
      <div class="observatory-timeline">
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" class="timeline-chart" aria-hidden="true">
          <path :d="timelinePath('support')" fill="none" stroke="var(--color-action)" stroke-width="0.7" stroke-dasharray="2.4 1" />
          <path :d="timelinePath('adoption')" fill="none" stroke="var(--sage-400)" stroke-width="0.7" />
          <path :d="timelinePath('objection')" fill="none" stroke="var(--color-danger)" stroke-width="0.7" stroke-dasharray="1 1.4" />
          <path :d="timelinePath('uncertainty')" fill="none" stroke="var(--slate-400)" stroke-width="0.5" />
          <line
            :x1="(tick / fixture.scenario.total_ticks) * 100"
            :x2="(tick / fixture.scenario.total_ticks) * 100"
            y1="0"
            y2="44"
            stroke="var(--color-text)"
            stroke-width="0.4"
          />
        </svg>
        <div class="timeline-legend mono-label" aria-hidden="true">
          <span>— support</span><span>— adoption</span><span>- - objection</span><span>… uncertainty</span>
        </div>
        <label class="scrubber">
          <span class="mono-label">Tick scrubber</span>
          <input
            v-model.number="tick"
            type="range"
            min="1"
            :max="fixture.scenario.total_ticks"
            step="1"
            :aria-valuetext="`Tick ${tick} of ${fixture.scenario.total_ticks}`"
          />
        </label>
        <div class="timeline-readout mono-label">
          <span>support {{ Math.round(seriesAtTick.support * 100) }}%</span>
          <span>adoption {{ Math.round(seriesAtTick.adoption * 100) }}%</span>
          <span>objection {{ Math.round(seriesAtTick.objection * 100) }}%</span>
          <span>uncertainty {{ Math.round(seriesAtTick.uncertainty * 100) }}%</span>
        </div>
        <p class="credit-estimate">
          <strong>{{ credits.toLocaleString() }}</strong> credits · {{ provider.label }} ({{
            provider.model_label
          }}) — {{ fixture.credit_model.disclaimer }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.observatory {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 560px;
}
.illustrative {
  position: absolute;
  inset: var(--space-3) var(--space-4) auto auto;
  color: var(--color-action);
  z-index: 3;
}
.observatory-state {
  padding: var(--space-16) var(--space-8);
  text-align: center;
  color: var(--color-text-secondary);
}
.observatory-error {
  color: var(--color-danger);
}
.observatory-summary-fallback {
  margin: var(--space-4) auto 0;
  color: var(--color-text-secondary);
  max-width: 56ch;
  text-align: left;
}
.observatory-topbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  align-items: flex-start;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  position: relative;
  z-index: 2;
  background: color-mix(in oklab, var(--ink-900) 82%, transparent);
}
.topbar-value {
  margin: 0;
  font-weight: 600;
  font-size: 0.95rem;
}
.provider-control {
  border: none;
  margin: 0;
  padding: 0;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.segmented-option {
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
}
.segmented-option.active {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
}
.observatory-body {
  display: grid;
  grid-template-columns: 1fr 320px;
  flex: 1;
  min-height: 340px;
  position: relative;
}
.observatory-canvas-pane {
  position: relative;
}
.segment-chips {
  position: absolute;
  inset: auto var(--space-3) var(--space-3) var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  z-index: 2;
}
.segment-chip {
  background: color-mix(in oklab, var(--ink-900) 85%, transparent);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-3);
  font-size: 0.82rem;
  cursor: pointer;
}
.segment-chip.active {
  border-color: var(--color-action);
  color: var(--color-action);
}
.evidence-rail {
  border-inline-start: 1px solid var(--color-border);
  padding: var(--space-4);
  background: var(--color-bg-inset);
  overflow-y: auto;
  max-height: 460px;
}
.evidence-rail h3 {
  font-size: 1.2rem;
  margin-bottom: var(--space-2);
}
.stance {
  font-weight: 600;
  margin-bottom: var(--space-2);
}
.stance[data-stance="support"] {
  color: var(--color-action);
}
.stance[data-stance="object"] {
  color: var(--color-danger);
}
.evidence-item {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
  margin-top: var(--space-3);
}
.evidence-item blockquote {
  margin: var(--space-2) 0 0;
  padding-inline-start: var(--space-3);
  border-inline-start: 2px solid var(--color-grid-guide);
  font-size: 0.92rem;
  color: var(--color-text);
}
.observatory-timeline {
  border-top: 1px solid var(--color-border);
  padding: var(--space-3) var(--space-6) var(--space-4);
  position: relative;
  z-index: 2;
  background: color-mix(in oklab, var(--ink-900) 82%, transparent);
}
.timeline-chart {
  width: 100%;
  height: 64px;
  display: block;
}
.timeline-legend {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.scrubber {
  display: block;
  margin-top: var(--space-2);
}
.scrubber input {
  width: 100%;
}
.timeline-readout {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-top: var(--space-2);
}
.credit-estimate {
  margin: var(--space-2) 0 0;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}
.credit-estimate strong {
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 1.15rem;
}
.canvas-poster {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: var(--space-2);
  align-content: center;
}
.canvas-poster svg {
  width: min(70%, 320px);
}
@media (max-width: 1024px) {
  .observatory-body {
    grid-template-columns: 1fr;
  }
  .evidence-rail {
    border-inline-start: none;
    border-top: 1px solid var(--color-border);
    max-height: none;
  }
}
</style>
