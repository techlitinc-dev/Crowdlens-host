<template>
  <div class="landing">
    <a class="skip-link" href="#main">Skip to content</a>
    <SiteHeader />
    <main id="main">
      <!-- Hero (design.md §3.2): five-column grid, copy spans two,
           observatory spans three. -->
      <section class="hero" aria-labelledby="hero-heading">
        <div class="hero-copy">
          <p class="section-eyebrow">SYNTHETIC POPULATION OBSERVATORY / BETA</p>
          <h1 id="hero-heading" class="hero-heading">
            A million perspectives.<br />One decision you can defend.
          </h1>
          <p class="hero-body">
            Upload the announcement, policy, or launch plan. CrowdLens builds a source-grounded
            population, tests the narrative across segments, and shows you which objections
            spread—and why.
          </p>
          <div class="hero-actions">
            <NuxtLink to="/app" class="hero-cta">Run a scenario</NuxtLink>
            <NuxtLink to="/sample-report" class="hero-secondary">Explore a sample report</NuxtLink>
          </div>
          <p class="hero-microcopy mono-label">
            Scenario exploration, not a guaranteed forecast. Provider and credit estimate shown
            before every run.
          </p>
        </div>
        <div class="hero-observatory">
          <HeroObservatory />
        </div>
      </section>

      <SectionPressure />
      <SectionPipeline />
      <SectionNotChatbots />

      <section class="section-frame" aria-labelledby="evidence-heading">
        <p class="section-eyebrow">Section IV</p>
        <h2 id="evidence-heading" class="section-title">Read the crowd, then inspect the evidence</h2>
        <div class="evidence-embed">
          <SampleReportView compact />
        </div>
        <div class="evidence-cta">
          <NuxtLink to="/sample-report" class="hero-cta">Open the full sample report</NuxtLink>
        </div>
      </section>

      <SectionsTrust />
      <SectionsPricing />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.hero {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 2fr 3fr;
  gap: var(--space-8);
  align-items: center;
  max-width: 1600px;
  margin: 0 auto;
  padding: calc(var(--space-24) + var(--space-8)) var(--space-8) var(--space-16);
}
@media (max-width: 1200px) {
  .hero {
    grid-template-columns: 1fr;
    min-height: auto;
  }
}
.hero-heading {
  font-size: clamp(3rem, 7vw, 7.5rem);
  line-height: 0.92;
  font-weight: 600;
  letter-spacing: -0.055em;
  max-width: 10ch;
}
.hero-body {
  font-size: 1.1rem;
  color: var(--color-text-secondary);
  margin-top: var(--space-6);
}
.hero-actions {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  flex-wrap: wrap;
  margin-top: var(--space-8);
}
.hero-cta {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-control);
}
.hero-cta:hover {
  text-decoration: none;
  filter: brightness(1.08);
}
.hero-secondary {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: var(--space-3) var(--space-6);
  color: var(--color-text);
}
.hero-microcopy {
  margin-top: var(--space-4);
}
.hero-observatory {
  min-height: 560px;
  position: relative;
}
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 20ch;
}
.evidence-embed {
  margin-top: var(--space-8);
}
.evidence-cta {
  margin-top: var(--space-8);
}
</style>
