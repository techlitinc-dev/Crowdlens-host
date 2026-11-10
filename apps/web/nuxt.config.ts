import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: false },
  modules: [],
  routeRules: {
    // Authenticated app uses client-side data fetching only: cookies are
    // sent with credentials:include and tenant context is per-request.
    "/app/**": { ssr: false },
    // Public pages stay server-rendered (design.md §11 SEO).
    "/": { ssr: true },
    "/sample-report": { ssr: true },
    // Same-origin API: the Nuxt server proxies /v1 to the control API so
    // session cookies stay first-party (they are HttpOnly + SameSite=Lax).
    // Used in dev and production (nitro route proxy).
    "/v1/**": {
      proxy: `${process.env.CONTROL_API_ORIGIN ?? "http://localhost:4000"}/v1/**`,
    },
  },
  runtimeConfig: {
    public: {
      apiOrigin: process.env.CONTROL_API_ORIGIN ?? "http://localhost:4000",
    },
  },
  vite: {
    server: {
      fs: {
        // pnpm monorepo: allow Vite to serve source from the app dir and the
        // workspace packages (@crowdlens/ui, @crowdlens/contracts).
        allow: [".", "../.."],
      },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: "en" },
      title: "CrowdLens — Synthetic population observatory",
      meta: [
        { name: "description", content: "Upload the announcement, policy, or launch plan. CrowdLens builds a source-grounded population, tests the narrative across segments, and shows which objections spread — and why." },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { property: "og:title", content: "CrowdLens — A million perspectives. One decision you can defend." },
        { property: "og:description", content: "Scenario exploration with synthetic populations, source-grounded evidence, and visible provenance. Not a guaranteed forecast." },
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap",
        },
      ],
    },
  },
});
