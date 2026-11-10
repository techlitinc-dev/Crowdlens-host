<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <BrandMark :size="24" />
        <p class="footer-note">
          Synthetic population observatory. Scenario exploration, not a
          guaranteed forecast.
        </p>
      </div>
      <nav class="footer-col" aria-label="Product">
        <h2 class="mono-label">Product</h2>
        <NuxtLink to="/#product">Overview</NuxtLink>
        <NuxtLink to="/sample-report">Sample report</NuxtLink>
        <NuxtLink to="/#pricing">Pricing</NuxtLink>
        <NuxtLink to="/#faq">FAQ</NuxtLink>
      </nav>
      <nav class="footer-col" aria-label="Company">
        <h2 class="mono-label">Company</h2>
        <NuxtLink to="/#method">Methodology</NuxtLink>
        <NuxtLink to="/#providers">Privacy &amp; control</NuxtLink>
        <a href="mailto:hello@crowdlens.example">Contact</a>
        <a href="https://github.com/crowdlens" rel="noopener">Source</a>
      </nav>
      <nav class="footer-col" aria-label="Legal">
        <h2 class="mono-label">Legal</h2>
        <NuxtLink to="/privacy">Privacy</NuxtLink>
        <NuxtLink to="/terms">Terms</NuxtLink>
        <span class="footer-status" role="status">
          <span class="status-dot" aria-hidden="true" /> System status: operational
        </span>
      </nav>
    </div>
    <div class="footer-base mono-label">
      © {{ new Date().getFullYear() }} CrowdLens. Open-fork licensing per the AGPL source-offer route; no certifications are claimed that have not been achieved.
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-raised);
}
.footer-inner {
  max-width: 1600px;
  margin: 0 auto;
  padding: var(--space-16) var(--space-8) var(--space-8);
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: var(--space-8);
}
.footer-note {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  max-width: 34ch;
  margin-top: var(--space-4);
}
.footer-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.footer-col a {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.footer-col a:hover {
  color: var(--color-text);
}
.footer-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  margin-top: var(--space-2);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-action);
}
.footer-base {
  border-top: 1px solid var(--color-border);
  padding: var(--space-4) var(--space-8);
  max-width: 1600px;
  margin: 0 auto;
  font-size: 11px;
}
@media (max-width: 900px) {
  .footer-inner {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
