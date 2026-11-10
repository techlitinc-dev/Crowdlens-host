<template>
  <!-- Section II — "From source to scenario" (design.md §3.5): one artifact
       shown in four real states. Content is plain DOM and readable without
       JavaScript; no scroll-jacking. -->
  <section id="method" class="section-frame" aria-labelledby="pipeline-heading">
    <p class="section-eyebrow">Section II</p>
    <h2 id="pipeline-heading" class="section-title">From source to scenario</h2>
    <p>
      Every run starts from your documents. The same artifact flows through four states —
      parsed with locators, grounded in a graph, expanded into a population, and reported
      with evidence links.
    </p>

    <ol class="pipeline">
      <li class="pipeline-step surface">
        <p class="mono-label">State 1 — Source</p>
        <h3>Parsed with stable locators</h3>
        <p class="locator">pricing-brief.md §2 · chunk 3/9</p>
        <blockquote>“Segment A cares about cost; Segment B cares about reliability. The rollout targets APAC first.”</blockquote>
        <p class="step-note">Chunks are content-addressed and reused across runs; the parser version is pinned in every manifest.</p>
      </li>
      <li class="pipeline-step surface" aria-current="step">
        <p class="mono-label">State 2 — Graph</p>
        <h3>Entities and relationships</h3>
        <ul class="entity-list">
          <li><span class="entity person">person/cohort</span> Segment A (SMEs)</li>
          <li><span class="entity concept">concept</span> per-seat cost</li>
          <li><span class="entity org">org</span> APAC partner network</li>
        </ul>
        <p class="step-note">Embedding profile <code>ollama-nomic-embed-v1</code>; graph stored per tenant, never shared.</p>
      </li>
      <li class="pipeline-step surface">
        <p class="mono-label">State 3 — Population</p>
        <h3>Cohorts with direct vs surrogate split</h3>
        <p class="population-line">
          1,000,000 logical agents · <strong>4,800 direct reasoning</strong> · 99.52% cohort propagation
        </p>
        <p class="step-note">Stratified selection keeps the active set representative; the seed and ratio are recorded in the run manifest.</p>
      </li>
      <li class="pipeline-step surface">
        <p class="mono-label">State 4 — Report</p>
        <h3>Claims linked to evidence</h3>
        <p class="claim-example">“Cost objections cascade from finance reviewers.” → 1 source chunk + 1 aggregate + 1 agent response</p>
        <p class="step-note">Every claim carries provenance: source, simulated aggregate, or LLM-generated — never blended.</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 18ch;
}
.pipeline {
  list-style: none;
  margin: var(--space-8) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  counter-reset: step;
}
@media (max-width: 1200px) {
  .pipeline {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 720px) {
  .pipeline {
    grid-template-columns: 1fr;
  }
}
.pipeline-step {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: relative;
}
.pipeline-step blockquote {
  margin: 0;
  font-size: 0.95rem;
  border-inline-start: 2px solid var(--color-grid-guide);
  padding-inline-start: var(--space-3);
}
.pipeline-step h3 {
  font-size: 1.15rem;
  margin: 0;
}
.locator,
.step-note,
.claim-example,
.population-line {
  font-size: 0.92rem;
  color: var(--color-text-secondary);
}
.step-note {
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: 0.85rem;
}
.entity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  font-size: 0.95rem;
}
.entity {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0 var(--space-1);
  margin-inline-end: var(--space-2);
  text-transform: uppercase;
}
.entity.person {
  color: var(--color-action);
}
.entity.concept {
  color: var(--sage-400);
}
.entity.org {
  color: var(--slate-400);
}
strong {
  color: var(--color-action);
}
code {
  font-family: var(--font-mono);
  font-size: 0.85em;
}
</style>
