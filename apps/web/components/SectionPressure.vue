<script setup lang="ts">
/**
 * Section I — "Put the decision under pressure" (design.md §3.4):
 * A/B announcement comparison with a segment reaction matrix; the control
 * switches options and updates the matrix/timeline fixtures.
 */

const options = {
  A: {
    label: "Option A — price in the post",
    announcement:
      "We are launching CrowdLens Pro today. New per-seat pricing starts at ₹499/user/month and takes effect immediately for new workspaces.",
    changed: "New per-seat pricing starts at ₹499/user/month and takes effect immediately",
    matrix: [
      { segment: "Cost-sensitive SMEs", support: 12, objections: 58, uncertainty: 30, evidence: 9 },
      { segment: "Reliability-first operators", support: 41, objections: 18, uncertainty: 41, evidence: 6 },
      { segment: "Platform builders", support: 52, objections: 8, uncertainty: 40, evidence: 4 },
      { segment: "Regional partners", support: 22, objections: 12, uncertainty: 66, evidence: 2 },
      { segment: "Finance reviewers", support: 9, objections: 71, uncertainty: 20, evidence: 7 },
    ] as const,
  },
  B: {
    label: "Option B — evidence first",
    announcement:
      "We are launching CrowdLens Pro today. Reliability evidence and a cost calculator ship alongside the announcement; existing workspaces keep current pricing for 90 days.",
    changed: "Reliability evidence and a cost calculator ship alongside the announcement",
    matrix: [
      { segment: "Cost-sensitive SMEs", support: 34, objections: 27, uncertainty: 39, evidence: 12 },
      { segment: "Reliability-first operators", support: 63, objections: 7, uncertainty: 30, evidence: 10 },
      { segment: "Platform builders", support: 71, objections: 4, uncertainty: 25, evidence: 6 },
      { segment: "Regional partners", support: 38, objections: 8, uncertainty: 54, evidence: 5 },
      { segment: "Finance reviewers", support: 26, objections: 39, uncertainty: 35, evidence: 9 },
    ] as const,
  },
};

const active = ref<"A" | "B">("B");

const insight = "The loudest segment is not always the largest. Inspect influence and sample composition together.";
</script>

<template>
  <section id="product" class="section-frame" aria-labelledby="pressure-heading">
    <p class="section-eyebrow">Section I</p>
    <h2 id="pressure-heading" class="section-title">Put the decision under pressure</h2>
    <p>
      Compare two announcement options against the same synthetic population. The matrix shows
      support, objections, uncertainty, and how much evidence each reaction draws on.
    </p>

    <div class="pressure-grid">
      <div class="announcement-comparison">
        <div class="segmented" role="tablist" aria-label="Announcement option">
          <button
            v-for="(option, key) in options"
            :key="key"
            type="button"
            role="tab"
            class="segmented-option"
            :class="{ active: active === key }"
            :aria-selected="active === key"
            @click="active = key as 'A' | 'B'"
          >
            {{ option.label }}
          </button>
        </div>
        <figure class="announcement surface">
          <blockquote>
            {{ options[active].announcement }}
          </blockquote>
          <figcaption class="mono-label">Changed sentence highlighted</figcaption>
          <mark>{{ options[active].changed }}</mark>
        </figure>
        <p class="insight">{{ insight }}</p>
      </div>

      <div class="reaction-matrix surface" aria-live="polite">
        <table class="table-plain">
          <caption class="visually-hidden">
            Segment reaction matrix for option {{ active }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Support</th>
              <th scope="col">Objections</th>
              <th scope="col">Uncertainty</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in options[active].matrix" :key="row.segment">
              <td>{{ row.segment }}</td>
              <td>
                <span class="bar support" :style="{ width: row.support + '%' }" />
                {{ row.support }}%
              </td>
              <td>
                <span class="bar objection" :style="{ width: row.objections + '%' }" />
                {{ row.objections }}%
              </td>
              <td>{{ row.uncertainty }}%</td>
              <td>{{ row.evidence }}</td>
            </tr>
          </tbody>
        </table>
        <p class="mono-label matrix-note">Fixture values — illustrative, not a benchmark.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 16ch;
}
.pressure-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: var(--space-8);
  margin-top: var(--space-8);
}
@media (max-width: 1024px) {
  .pressure-grid {
    grid-template-columns: 1fr;
  }
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  overflow: hidden;
  margin-bottom: var(--space-4);
}
.segmented-option {
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
}
.segmented-option.active {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
}
.announcement {
  padding: var(--space-6);
}
.announcement blockquote {
  margin: 0 0 var(--space-4);
  font-size: 1.1rem;
  line-height: 1.6;
}
.announcement mark {
  background: color-mix(in oklab, var(--signal-500) 22%, transparent);
  color: var(--color-text);
  padding: 0 var(--space-1);
  border-radius: 3px;
}
.insight {
  margin-top: var(--space-4);
  color: var(--color-text-secondary);
  border-inline-start: 2px solid var(--color-action);
  padding-inline-start: var(--space-3);
}
.reaction-matrix {
  padding: var(--space-4);
  overflow-x: auto;
}
.bar {
  display: inline-block;
  height: 8px;
  border-radius: 4px;
  margin-inline-end: var(--space-2);
  vertical-align: middle;
}
.bar.support {
  background: var(--color-action);
}
.bar.objection {
  background: var(--color-danger);
}
.matrix-note {
  margin-top: var(--space-3);
}
</style>
