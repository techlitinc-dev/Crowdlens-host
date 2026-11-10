<template>
  <div class="sample-page">
    <a class="skip-link" href="#report">Skip to report</a>
    <SiteHeader />
    <main id="report" class="section-frame report-frame">
      <SampleReportView />
      <div class="report-cta">
        <NuxtLink to="/app" class="report-cta-button">Run a scenario with your own sources</NuxtLink>
      </div>
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.report-frame {
  padding-top: calc(var(--space-24) + var(--space-8));
  max-width: 1100px;
}
.report-cta {
  margin: var(--space-8) 0 var(--space-16);
}
.report-cta-button {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-control);
}
.report-cta-button:hover {
  text-decoration: none;
  filter: brightness(1.08);
}
</style>
