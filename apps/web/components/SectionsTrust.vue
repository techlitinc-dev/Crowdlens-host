<template>
  <!-- Sections V + VI (design.md §3.8, §3.9): use cases and the provider
       configuration console with privacy/control copy. -->
  <section id="use-cases" class="section-frame" aria-labelledby="use-cases-heading">
    <p class="section-eyebrow">Section V</p>
    <h2 id="use-cases-heading" class="section-title">Use cases</h2>

    <div class="usecase-rows">
      <article class="usecase surface">
        <div>
          <h3>Communications</h3>
          <p class="usecase-input mono-label">Input: a public statement draft</p>
        </div>
        <p>
          Pressure-test a public statement before publication. See which segments parse your
          headline as a promise and which parse it as a loophole.
        </p>
        <p class="usecase-limit">Limitation: synthetic readers are not your subscribers; validate with real panels.</p>
      </article>
      <article class="usecase surface">
        <div>
          <h3>Product strategy</h3>
          <p class="usecase-input mono-label">Input: onboarding or pricing narrative</p>
        </div>
        <p>
          Compare onboarding, pricing, or launch narratives side by side and trace which
          objections are structural versus copy-level.
        </p>
        <p class="usecase-limit">Limitation: objection labels come from your source documents, not from market telemetry.</p>
      </article>
      <article class="usecase surface">
        <div>
          <h3>Policy research</h3>
          <p class="usecase-input mono-label">Input: a policy brief and stakeholder map</p>
        </div>
        <p>
          Explore segment concerns and second-order objections before a consultation, with
          evidence links back to the brief.
        </p>
        <p class="usecase-limit">Limitation: exploration aid, not a substitute for formal consultation.</p>
      </article>
      <article class="usecase surface">
        <div>
          <h3>Market research</h3>
          <p class="usecase-input mono-label">Input: positioning hypotheses</p>
        </div>
        <p>
          Generate hypotheses to validate with real research. Every claim keeps its provenance
          so field teams know what to test first.
        </p>
        <p class="usecase-limit">Limitation: outputs are hypotheses, not measurements — and never investment advice.</p>
      </article>
    </div>
  </section>

  <section id="providers" class="section-frame" aria-labelledby="providers-heading">
    <p class="section-eyebrow">Section VI</p>
    <h2 id="providers-heading" class="section-title">Providers, privacy, and control</h2>

    <div class="providers-grid">
      <div class="console surface" role="group" aria-label="Provider configuration console — illustrative">
        <div class="console-tabs" role="tablist" aria-label="Provider">
          <button type="button" class="console-tab active" role="tab" aria-selected="true">Gemini (AI Studio key)</button>
          <button type="button" class="console-tab" role="tab" aria-selected="false">OpenRouter</button>
        </div>
        <dl class="console-rows">
          <div>
            <dt class="mono-label">Model</dt>
            <dd>Gemini 2.5 Flash · structured output ✓ · context 1M</dd>
          </div>
          <div>
            <dt class="mono-label">Data policy</dt>
            <dd>data_collection: deny · ZDR optional · BYOK envelope-encrypted, write-only</dd>
          </div>
          <div>
            <dt class="mono-label">Run status</dt>
            <dd><span class="pinned">Pinned for this run</span> — provider/model/prompt bundle locked in the manifest</dd>
          </div>
          <div>
            <dt class="mono-label">Credits</dt>
            <dd>estimate → reserve → settle actual → release remainder; hard cap shown before confirm</dd>
          </div>
        </dl>
        <p class="mono-label console-note">No secret fields in this demo — keys are configured in workspace settings.</p>
      </div>

      <div class="privacy-copy">
        <h3>Tenant isolation by construction</h3>
        <p>
          Every query runs under database row-level security scoped to your workspace; membership
          is re-verified on every request, so revocation takes effect immediately.
        </p>
        <h3>Your data, your keys</h3>
        <p>
          Documents live in your tenant-scoped object storage with hash-verified uploads. Bring
          your own Gemini or OpenRouter key; it is stored envelope-encrypted and never returned
          by any API.
        </p>
        <h3>Revocable by default</h3>
        <p>
          Report shares are expiring capability links you can revoke in one click — cached
          copies stop resolving immediately. Deleting a project tombstones it and schedules a
          full purge of documents, graphs, and artifacts.
        </p>
        <h3>Open-source route</h3>
        <p>
          CrowdLens ships under the AGPL with a visible source link. No certifications are
          claimed that have not been achieved.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 18ch;
}
.usecase-rows {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-8);
}
.usecase {
  display: grid;
  grid-template-columns: 1fr 2fr 1.2fr;
  gap: var(--space-6);
  padding: var(--space-6);
  align-items: start;
}
@media (max-width: 1024px) {
  .usecase {
    grid-template-columns: 1fr;
  }
}
.usecase h3 {
  margin: 0 0 var(--space-2);
  font-size: 1.3rem;
}
.usecase-input {
  margin: 0;
}
.usecase-limit {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin: 0;
}
.providers-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: var(--space-8);
  margin-top: var(--space-8);
}
@media (max-width: 1024px) {
  .providers-grid {
    grid-template-columns: 1fr;
  }
}
.console {
  padding: var(--space-4);
}
.console-tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-3);
}
.console-tab {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
}
.console-tab.active {
  color: var(--color-action);
  border-color: var(--color-action);
}
.console-rows {
  display: grid;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.console-rows div {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: var(--space-3);
}
.console-rows dd {
  margin: 0;
  font-size: 0.95rem;
}
.pinned {
  color: var(--color-action);
  font-weight: 600;
}
.console-note {
  color: var(--color-text-secondary);
}
.privacy-copy h3 {
  font-size: 1.2rem;
  margin: var(--space-6) 0 var(--space-2);
}
.privacy-copy h3:first-child {
  margin-top: 0;
}
.privacy-copy p {
  color: var(--color-text-secondary);
}
</style>
