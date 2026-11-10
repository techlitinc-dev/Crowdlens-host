<script setup lang="ts">
/**
 * Fixture-backed sample report (design.md §3.7, §5.4). Shared by the landing
 * embed (Section IV) and the public /sample-report route. Every claim opens
 * its evidence beside it; provenance labels are always visible.
 */
import fixtureJson from "~/fixtures/sample-report.json";
import type { SampleClaim, SampleReport } from "~/types/observatory";

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const report = fixtureJson as unknown as SampleReport;

const expandedClaim = ref<string | null>(report.claims[0]?.claim_id ?? null);
const methodOpen = ref(false);

function toggleClaim(claim: SampleClaim) {
  expandedClaim.value = expandedClaim.value === claim.claim_id ? null : claim.claim_id;
}

const provenanceClass = (type: string) =>
  type === "source_chunk" ? "prov-source" : type === "event_aggregate" ? "prov-aggregate" : "prov-llm";
</script>

<template>
  <article class="sample-report">
    <p class="mono-label report-label">{{ report.label }} · {{ report.fixture_version }}</p>
    <h1 v-if="!compact" class="report-title">{{ report.title }}</h1>

    <section class="report-summary surface" aria-labelledby="summary-heading">
      <h2 id="summary-heading">Executive summary</h2>
      <p class="recommendation">{{ report.summary.recommendation }}</p>
      <p>{{ report.summary.text }}</p>
    </section>

    <section aria-labelledby="segments-heading">
      <h2 id="segments-heading">Segment reaction</h2>
      <div class="surface table-scroll">
        <table class="table-plain">
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Share</th>
              <th scope="col">Stance</th>
              <th scope="col">Δ vs t0</th>
              <th scope="col">Top objections</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="segment in report.segments" :key="segment.name">
              <td>{{ segment.name }}</td>
              <td>{{ Math.round(segment.share * 100) }}%</td>
              <td>{{ segment.stance }}</td>
              <td>{{ segment.delta }}</td>
              <td>{{ segment.objections.join(", ") || "—" }}</td>
              <td>{{ segment.evidence_count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="claims-heading">
      <h2 id="claims-heading">Claims and evidence</h2>
      <ul class="claim-list">
        <li v-for="claim in report.claims" :key="claim.claim_id" class="claim surface">
          <button
            type="button"
            class="claim-toggle"
            :aria-expanded="expandedClaim === claim.claim_id"
            @click="toggleClaim(claim)"
          >
            <span class="claim-text">{{ claim.text }}</span>
            <span class="mono-label">{{ claim.confidence_label }} · {{ claim.method }}</span>
          </button>
          <div v-if="expandedClaim === claim.claim_id" class="claim-evidence">
            <div v-for="(item, index) in claim.evidence" :key="index" class="evidence-card" :class="provenanceClass(item.type)">
              <p class="mono-label">
                {{ item.type === "source_chunk" ? "SOURCE" : item.type === "event_aggregate" ? "SIMULATED AGGREGATE" : "LLM-GENERATED" }}
                · {{ item.id }}
              </p>
              <blockquote>{{ item.excerpt }}</blockquote>
              <p v-if="item.relation" class="mono-label">relation: {{ item.relation }}</p>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <section aria-labelledby="objections-heading">
      <h2 id="objections-heading">Objection timeline</h2>
      <ol class="objection-timeline">
        <li v-for="point in report.objection_timeline" :key="point.tick" class="surface">
          <p class="mono-label">tick {{ point.tick }} · intensity {{ point.intensity }}</p>
          <p>{{ point.label }}</p>
        </li>
      </ol>
    </section>

    <section class="surface method-drawer">
      <button type="button" class="method-toggle" :aria-expanded="methodOpen" @click="methodOpen = !methodOpen">
        <span>Method and limitations</span>
        <span aria-hidden="true">{{ methodOpen ? "−" : "+" }}</span>
      </button>
      <dl v-if="methodOpen" class="method-grid">
        <template v-for="(value, key) in report.method" :key="key">
          <dt class="mono-label">{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
      <ul v-if="methodOpen" class="limitations">
        <li v-for="limitation in report.limitations" :key="limitation">{{ limitation }}</li>
      </ul>
    </section>

    <p class="disclaimer">{{ report.disclaimer }}</p>
    <slot name="cta" />
  </article>
</template>

<style scoped>
.sample-report {
  display: grid;
  gap: var(--space-8);
}
.report-label {
  color: var(--color-action);
}
.report-title {
  font-size: clamp(2rem, 4vw, 3.4rem);
  font-weight: 600;
  max-width: 24ch;
}
.sample-report h2 {
  font-size: clamp(1.5rem, 2.4vw, 2.2rem);
  font-weight: 600;
}
.report-summary {
  padding: var(--space-6);
}
.recommendation {
  font-weight: 600;
  font-size: 1.1rem;
}
.table-scroll {
  overflow-x: auto;
  padding: var(--space-2);
}
.claim-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.claim {
  overflow: hidden;
}
.claim-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  background: transparent;
  border: none;
  color: var(--color-text);
  text-align: start;
  padding: var(--space-4);
  cursor: pointer;
}
.claim-toggle:hover .claim-text {
  color: var(--color-action);
}
.claim-text {
  font-size: 1.05rem;
}
.claim-evidence {
  display: grid;
  gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-4);
}
.evidence-card {
  border: 1px solid var(--color-border);
  border-inline-start-width: 3px;
  border-radius: var(--radius-control);
  padding: var(--space-3);
}
.evidence-card blockquote {
  margin: var(--space-2) 0;
  font-size: 0.95rem;
}
.prov-source {
  border-inline-start-color: var(--sage-400);
}
.prov-aggregate {
  border-inline-start-color: var(--signal-500);
}
.prov-llm {
  border-inline-start-color: var(--slate-400);
}
.objection-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-3);
}
@media (max-width: 1024px) {
  .objection-timeline {
    grid-template-columns: 1fr;
  }
}
.objection-timeline li {
  padding: var(--space-3);
}
.method-drawer {
  padding: var(--space-4);
}
.method-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  background: transparent;
  border: none;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.method-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: var(--space-4) 0;
}
.method-grid dd {
  margin: 0;
  font-size: 0.95rem;
}
.limitations {
  margin: 0;
  padding-inline-start: var(--space-4);
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  display: grid;
  gap: var(--space-2);
}
.disclaimer {
  border: 1px solid var(--color-border);
  border-inline-start: 3px solid var(--color-danger);
  border-radius: var(--radius-control);
  padding: var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.95rem;
}
</style>
