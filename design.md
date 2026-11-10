# CrowdLens — Brand, Product Design, and Landing-Page Specification

**Document:** `design.md`  
**Status:** v1.0 — implementation-ready UX direction  
**Date:** 2026-11-09  
**Companion documents:** `specs.md`, `architecture.md`, `instructions.md`

## 1. Design idea: the crowd observatory

CrowdLens should feel like a serious instrument for examining collective behaviour—not another purple-gradient AI wrapper. The visual idea is an **observatory**: a dark drafting table, fine structural guides, live population constellations, precise labels, and a mint signal that reveals what matters.

The product interface is the primary visual asset. The landing page’s hero contains a working, fixture-driven scenario observatory rather than a stock photograph or an abstract “AI brain.”

### 1.1 Locked design decisions

1. **Colour stance:** near-black charcoal, warm parchment text, restrained mint signal, sage secondary, coral only for risk.
2. **Typography:** Space Grotesk for display, Inter for reading/UI, and a system monospace stack for evidence IDs, numbers, and configuration.
3. **Layout:** asymmetric five-column editorial grid with fine vertical guides; hero copy left, live observatory right.
4. **Motion:** cohort constellations reorganise with bounded scroll/input; progress uses `scaleX`; controls respond in under 250 ms.
5. **Signature detail:** a local “lens” inspection mode over the network visualisation reveals segment evidence without taking over the whole page.

### 1.2 Voice

Direct, evidence-led, and calm. Prefer:

- “Inspect why the narrative moved.”
- “1,000,000 logical agents. A bounded active-reasoning budget.”
- “Illustrative simulation, not a representative survey.”

Avoid “revolutionary,” “unleash,” “seamless,” “magical,” “guaranteed prediction,” unsupported customer numbers, fake logos, and vague claims such as “millions of minds working for you” without explaining the execution model.

## 2. Brand system

### 2.1 Name and wordmark

**CrowdLens** is set in Space Grotesk 600 with tight tracking. “Crowd” uses parchment; “Lens” may use mint in static brand lockups, but gradient text is prohibited.

The symbol is an aperture formed by six unevenly spaced nodes around an open centre. One outer node breaks the perfect ring, representing a non-obvious segment. It must remain recognisable at 24 px and work as a single-colour mark. Do not substitute an unstyled letter “C,” an eye cliché, or a generic hexagonal AI icon.

### 2.2 Colour tokens

Implement colours through three tiers: primitive → semantic → component. Values below are the canonical primitives; equivalent OKLCH values support theme tuning.

| Primitive | Hex | OKLCH | Use |
|---|---|---|---|
| `ink-950` | `#0A0A0A` | `oklch(0.145 0 89.9)` | Main ground |
| `ink-900` | `#141414` | `oklch(0.191 0 89.9)` | Raised surface |
| `ink-850` | `#1A1A1A` | `oklch(0.218 0 89.9)` | Active/embedded surface |
| `paper-100` | `#F4ECD8` | `oklch(0.944 0.028 88.8)` | Primary text and light surfaces |
| `signal-500` | `#00D9A3` | `oklch(0.786 0.161 166.9)` | Primary action, active signal |
| `sage-400` | `#85C093` | `oklch(0.755 0.089 151.2)` | Secondary series and quiet success |
| `forest-700` | `#117025` | `oklch(0.477 0.139 145.8)` | Deep green structural accents |
| `slate-400` | `#9CA3AF` | `oklch(0.714 0.019 261.3)` | Secondary text |
| `slate-500` | `#6B7280` | `oklch(0.551 0.023 264.4)` | Nonessential labels only after contrast check |
| `risk-500` | `#FF4444` | `oklch(0.664 0.223 25.7)` | Error, risk, eliminated option |

Semantic tokens:

```css
:root {
  --color-bg: var(--ink-950);
  --color-bg-raised: var(--ink-900);
  --color-bg-inset: var(--ink-850);
  --color-text: var(--paper-100);
  --color-text-secondary: var(--slate-400);
  --color-action: var(--signal-500);
  --color-on-action: var(--ink-950);
  --color-danger: var(--risk-500);
  --color-grid-guide: oklch(0.477 0.139 145.8 / 0.35);
  --color-border: oklch(0.944 0.028 88.8 / 0.14);
  --color-focus: var(--signal-500);
}
```

Rules:

- Mint occupies no more than roughly 10% of a viewport; it is a signal, not a background wash.
- No purple-blue gradients, gradient headlines, pure black, or pure white.
- Body text must meet 4.5:1 contrast; large text and meaningful UI boundaries at least 3:1.
- Never place low-contrast grey text on a coloured panel.
- Colour never carries sentiment or status alone; pair with labels, line styles, or icons.

### 2.3 Typography

| Role | Family | Size/line height | Weight/tracking |
|---|---|---|---|
| Hero display | Space Grotesk | `clamp(3rem, 7vw, 7.5rem)` / 0.92 | 550–650, `-0.055em` |
| Section display | Space Grotesk | `clamp(2.25rem, 4vw, 4.75rem)` / 1.0 | 500–600, `-0.04em` |
| App page title | Space Grotesk | 32–44 px / 1.1 | 600, `-0.025em` |
| Body | Inter | 16–18 px / 1.55–1.7 | 400–500 |
| UI | Inter | 14–16 px / 1.35–1.5 | 450–600 |
| Data/labels | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | 11–14 px / 1.4 | 500, `0.06em` for uppercase labels |
| Large metric | Space Grotesk + tabular numerals | 36–64 px / 1 | 550, `-0.03em` |

Body measure is 65–75 characters. Use uppercase monospace only for short labels, not paragraphs. Load only required font weights, use `font-display: swap`, and keep fallback metrics close to avoid layout shift.

### 2.4 Grid, spacing, shape, and material

- Public page: five-column asymmetric grid inside a maximum 1600 px frame; fine vertical drafting guides remain visible on wide screens.
- Application: desktop observatory uses a 280 px control rail, fluid centre, and 360 px evidence rail; both rails become accessible drawers below 1024 px.
- Spacing uses a 4/8 px scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Borders are 0.5–1 px with low-opacity parchment/forest tones. Avoid heavy shadows and glowing card stacks.
- Radius: 6 px controls, 10 px panels, 14 px large embedded product surfaces. Do not make every label a pill.
- Surface depth comes from border contrast, slight material shifts, and fine grain—not nested cards.
- A very subtle monochrome noise texture may cover the public page at 2–3% opacity. It must not reduce text contrast or add a large image download.

## 3. Landing-page structure

### 3.1 Header

**Content:** symbol + CrowdLens; Product, Method, Use cases, Pricing, Sample report; Sign in; **Run a scenario**.

- Header starts transparent over the hero and gains an opaque charcoal surface after leaving the top 24 px.
- Desktop navigation anchors scroll to real section IDs.
- Mobile opens a keyboard-operable drawer with close button, Escape, backdrop, and focus return.
- “Run a scenario” goes to sign-up/workspace creation, not a dead modal.
- “Sample report” opens a real fixture-backed report route.

### 3.2 Hero — “See the decision from every side”

Use a minimum-height `100dvh` composition with the five-column grid. Copy spans approximately two columns; the observatory spans three.

**Eyebrow:** `SYNTHETIC POPULATION OBSERVATORY / BETA`  
**Headline:** **“A million perspectives. One decision you can defend.”**  
**Body:** “Upload the announcement, policy, or launch plan. CrowdLens builds a source-grounded population, tests the narrative across segments, and shows you which objections spread—and why.”  
**Primary CTA:** **Run a scenario**  
**Secondary CTA:** **Explore a sample report**  
**Microcopy:** “Scenario exploration, not a guaranteed forecast. Provider and credit estimate shown before every run.”

Do not force the headline into a centred block. Keep ragged-right composition and one strong line break after “perspectives.”

### 3.3 Hero observatory

The observatory is a real Vue component driven by a versioned local fixture. It is clearly labelled **ILLUSTRATIVE SAMPLE**, not “live customer data.”

**Top bar:**

- Scenario: `Launch announcement / APAC fintech`.
- State: `TICK 18 / 24`.
- Provider segmented control: `Gemini` / `OpenRouter`.
- Population label: `1,000,000 logical · 4,800 active reasoning` as illustrative configuration, not a benchmark claim.

**Centre:**

- Canvas network with at most ~1,200 representative desktop nodes and ~400 mobile nodes; each node may represent a cohort, never one DOM node per logical agent.
- Nodes form five recognisable audience communities. Direct-LLM agents use solid mint rings; surrogate cohorts use outlined parchment/sage marks.
- A local lens follows pointer only inside the canvas. Tap/keyboard segment selection provides the same inspection.
- Selecting a cohort updates the evidence rail and timeline; it does not merely animate.

**Evidence rail:**

- Segment name and stance delta.
- “What changed” concise summary.
- One source excerpt, one aggregated simulation event, and one direct agent quote.
- Provenance labels: `SOURCE`, `SIMULATED AGGREGATE`, `LLM-GENERATED`.

**Bottom timeline:**

- Sentiment/narrative-adoption series with labels and patterns.
- Tick scrubber updates the visible fixture state.
- Credit estimate and provider label update when the provider control changes. Values are explicitly illustrative.

The component needs loading, fixture-error, WebGL/canvas-unavailable, reduced-motion, and disconnected states. A static SVG/PNG poster and fully readable DOM summary appear if canvas fails.

### 3.4 Section I — “Put the decision under pressure”

A split editorial section compares two decision options rather than displaying generic feature cards.

- Left: user-authored announcement options A/B with highlighted changed sentence.
- Right: segment reaction matrix showing support, objections, uncertainty, and evidence count.
- A working control switches options and updates matrix/timeline fixtures.
- Include the insight: “The loudest segment is not always the largest. Inspect influence and sample composition together.”

### 3.5 Section II — “From source to scenario”

A sticky visual sequence with four real artifact states:

1. **Source:** pages/chunks with stable source locators.
2. **Graph:** entities and relationships; embedding profile shown.
3. **Population:** cohort generation; direct vs surrogate distinction.
4. **Report:** claims linked to evidence and configuration.

On scroll, the same artifact transforms through the four states rather than four unrelated screenshots. Content remains visible without JavaScript. Mobile uses a normal vertical sequence; no scroll-jacking.

### 3.6 Section III — “Not a million chatbots”

This is the credibility section and should be visually distinctive.

Use a large population field on one side and a compact reasoning console on the other. A bounded stream of active agents illuminates; the rest update as cohorts.

Copy:

> CrowdLens separates population scale from paid reasoning. Lightweight logical agents model the crowd. A bounded, stratified subset reasons directly with Gemini or OpenRouter models. Cohort rules propagate the effects, and every output says how it was produced.

Show three labelled layers: `LOGICAL STATE`, `ACTIVE REASONING`, `COHORT PROPAGATION`. Do not claim million-agent production readiness until the scale gate in `specs.md` passes; use “scale target” in pre-benchmark builds.

### 3.7 Section IV — “Read the crowd, then inspect the evidence”

Display an actual sample report page, not a generic testimonial.

- Executive summary with decision recommendation.
- Segment reaction table.
- Objection timeline.
- Claim selected → source excerpt and simulation aggregate open beside it.
- Method drawer with seed, provider, model, prompt version, active/surrogate ratio, and limitations.
- CTA **Open the full sample report**.

### 3.8 Section V — Use cases

Use alternating full-width editorial rows rather than three equal cards:

- **Communications:** pressure-test a public statement before publication.
- **Product strategy:** compare onboarding, pricing, or launch narratives.
- **Policy research:** explore segment concerns and second-order objections.
- **Market research:** generate hypotheses to validate with real research.

Each row contains a concrete input, a sample output, and a limitation. Financial/trading examples must include “not investment advice” if present.

### 3.9 Section VI — Providers, privacy, and control

A configuration console demonstrates the actual provider-switch contract:

- Gemini (AI Studio key) and OpenRouter tabs.
- Model selection from an illustrative server catalog.
- Data-policy indicators and structured-output support.
- “Pinned for this run” status.
- Credit estimate with a hard cap.
- No secret fields in the public demo.

Adjacent copy covers tenant isolation, private object storage, revocable shares, deletion, and the selected AGPL source-offer route. Do not claim certifications that have not been achieved.

### 3.10 Section VII — Pricing that shows the meter

Avoid the generic three-card pricing template. Use:

1. A compact plan comparison table using the launch hypotheses from `specs.md`.
2. An interactive **simulation credit estimator**.
3. A usage example showing estimate, reservation, actual debit, and released credits.

Estimator inputs: document pages, logical population, active-reasoning budget, ticks, report depth, provider/model class. Outputs: estimated range, hard cap, major cost drivers, and plan recommendation. Label values as estimates and show the rate-card version.

CTA behaviour:

- Free → create workspace.
- Paid → checkout/sign-in flow.
- Enterprise → real contact form with validation and success/error feedback.

### 3.11 FAQ and final CTA

FAQ must answer:

- Are these real people? **No.**
- Does one million agents mean one million LLM calls? **No.**
- Can I switch between Gemini and OpenRouter? **For new runs; existing runs stay pinned.**
- How do credits work? **Estimate, reserve, settle actual, release remainder.**
- Is this a guaranteed prediction? **No; use real-world validation.**
- What happens to my documents? **Answer from actual retention/provider policy.**
- Is the source available? **Link the selected licensing route.**

Final CTA: **“Bring the decision. We’ll bring the crowd.”** Buttons: **Run a scenario** and **Read the methodology**.

Footer includes Product, Methodology, Sample report, Pricing, Privacy, Terms, Contact, Source, system status, and copyright. No dead social icons.

## 4. Landing-page motion and craft

### 4.1 Motion choreography

- Hero nodes begin in loose source clusters and reorganise into audience cohorts as the first bounded scroll progress advances.
- The decision question stays in the DOM; canvas is decorative until the user explicitly selects the accessible interaction mode.
- Section progress bars animate with `transform: scaleX(...)`, not layout-changing width loops.
- Section entrances, if used, start at `scale(0.98)` plus a small opacity/translate change and never gate content visibility.
- Hover/focus/press transitions run 120–220 ms with ease-out. Exit transitions are faster.
- The lens inspection uses pointer/tap/keyboard input and stops when the canvas leaves the viewport.

### 4.2 Reduced motion and power

Under `prefers-reduced-motion: reduce`:

- Show the final coherent cohort layout immediately.
- Disable ambient drift, parallax, auto-scrub, and smooth scrolling.
- Keep explicit user-triggered state changes instantaneous or under 100 ms.
- Provide the same evidence and controls without animation.

Pause rendering when the tab is hidden or canvas is offscreen. Cap device pixel ratio and adapt node count to device capability. No full-screen autoplay video is needed.

## 5. Authenticated application information architecture

```text
/app/:workspace/projects
/app/:workspace/projects/:projectId
/app/:workspace/simulations/:simulationId
/app/:workspace/reports/:reportId
/app/:workspace/reports/:reportId/interview
/app/:workspace/usage
/app/:workspace/settings/members
/app/:workspace/settings/providers
/app/:workspace/settings/billing
/app/:workspace/settings/data
```

The public sample report uses a separate read-only fixture route and must not expose customer data.

### 5.1 Workspace home

- Decision-focused project list, not a vanity metrics dashboard.
- Primary action **New scenario**.
- Rows show question, stage, last activity, owner, credit usage, and report availability.
- Usage strip shows included/top-up balance and active reservations with a link to the ledger.
- Empty state provides a real sample project action and upload action.

### 5.2 Scenario builder

A five-stage workflow preserves MiroFish’s conceptual model:

1. **Evidence:** upload/parse/source inspection.
2. **World:** graph, entities, ontology, embedding profile.
3. **Crowd:** population, cohorts, reasoning budget, seed.
4. **Run:** provider/model, ticks, hard cap, estimate, confirmation.
5. **Report:** progress, findings, evidence, export/share/interview.

Users can move back to inspect without losing state. Any change that invalidates a downstream artifact explains why and shows the new estimate. Provider/model switching is disabled after run confirmation except through **Clone with new configuration**.

### 5.3 Run observatory

**Left rail — configuration:** source set, provider/model, seed, population, active budget, hard cap, stage timeline.  
**Centre — world:** cohort network and tick timeline with virtualised event samples.  
**Right rail — evidence:** selected segment, narratives, objections, source excerpts, and provenance.  
**Bottom status:** actual credits, reservation, queue/worker state, last checkpoint, connection state.

Controls: pause if supported, cancel with confirmation, clone, open report. Cancel explains that consumed work is billed and unused reservation is released.

Never render the full agent list or event firehose. Provide sampled events, aggregates, and server-side filtering.

### 5.4 Report reader

- Executive view first; evidence density increases progressively.
- Sticky table of contents: Summary, Segments, Timeline, Narratives, Objections, Options, Method, Limitations.
- Claim hover/focus/tap opens evidence in the right rail or mobile sheet.
- Provenance chips have text labels and different shapes, not colour alone.
- Compare runs by seed/config with aligned segments and clear variance language.
- Export menu creates durable jobs for large exports and reports progress.
- Share dialog exposes expiry, scope, revoke, and copy-link feedback.

### 5.5 Agent interview

- Agent identity/persona, active vs surrogate status, run and tick context.
- Suggested questions grounded in that agent’s visible history.
- Responses label generated content and link to memory/evidence artifacts.
- Unavailable surrogate interview explains that direct reasoning must be generated and may consume credits; never fabricate a historical direct response.

### 5.6 Provider settings

- Provider tabs with validation state, server catalog, model allowlist, data-policy controls, and cost/latency observations.
- Secret inputs are write-only; saved keys never reappear.
- Validation shows pending, success, actionable failure, and quota-exhausted states.
- Changing defaults includes “applies to new runs only.”

### 5.7 Billing and usage

- Current plan, renewal state, next billing boundary, and payment state.
- Included credits, top-up credits, active reservations, and available balance.
- **Buy credits** uses one-time checkout; **Change plan** uses subscription flow.
- Ledger table filters by run/type/date and exports reconciliation data.
- Run detail shows estimate vs actual, model tokens/cached tokens where available, worker usage, and rate-card version.
- Grace-period UI stops new paid runs but preserves report access and offers a working retry-payment path.

## 6. Component states and interaction integrity

Every interactive element needs default, hover, focus-visible, active, disabled, and loading treatment where relevant. Touch targets are at least 44 px. A disabled control explains why; do not hide critical actions without guidance.

Required application states:

- Empty project/report.
- Parsing and graph-building progress.
- Queued, preparing, running, finalizing, completed.
- Paused, cancellation requested, cancelled.
- Provider timeout/rate limit/quota exhausted.
- Credit estimate changed, insufficient credits, reservation settled.
- SSE reconnecting and stale-data indicator with polling fallback.
- Cache/artifact reused notification where useful.
- Partial report and evidence unavailable.
- Share expired/revoked.
- Payment pending, succeeded, failed, refunded, and renewal grace.
- Worker recovered from checkpoint.

All dialogs, drawers, menus, tabs, accordions, and sheets are keyboard-operable. Overlays support a visible close action and Escape; modal focus is trapped and restored. Destructive actions name the affected resource.

## 7. Data-visualisation rules

1. Always state whether a visual shows source facts, direct LLM output, cohort inference, or aggregate simulation.
2. Show active-reasoning count and sample composition beside sentiment metrics.
3. Use solid lines for direct observations, dashed for surrogate inference, and dotted for forecast/projection.
4. Pair every colour with labels and line/marker differences.
5. Do not display precise percentages without denominator and method.
6. Include multiple-seed spread where available; avoid unsupported confidence intervals.
7. Use tabular numerals and locale-aware number formatting.
8. Provide a table alternative for every decision-relevant chart.
9. Virtualise long lists and sample network/event visuals; do not degrade browser responsiveness for visual spectacle.
10. A network graph is exploratory, not proof of real social causality.

## 8. Responsive behaviour

| Viewport | Behaviour |
|---|---|
| 375 px | Single-column hero; observatory below copy; simplified fixture; rails become sheets; table alternatives replace dense charts. |
| 768 px | Two-column selected sections; hero remains stacked; mobile drawer navigation; canvas node count reduced. |
| 1024 px | Hero copy/observatory may split; app uses one collapsible rail; pricing table scrolls internally with sticky labels. |
| 1440 px | Full five-column editorial grid, three-rail observatory, visible drafting guides, and evidence side panel. |

No fixed-width element may force page-level horizontal scrolling. Dense data regions may have their own labelled scroll container with a mobile table/card alternative. Respect safe-area insets for full-screen and fixed-bottom UI.

## 9. Accessibility and content requirements

- Target WCAG 2.2 AA for public and core authenticated workflows.
- Semantic landmarks, one `h1`, logical heading order, skip link, and descriptive link text.
- Visible focus ring at least 2 px with sufficient contrast and offset.
- Canvas has an accessible name, text summary, and keyboard segment selector; purely decorative layers are `aria-hidden`.
- Live progress uses throttled `aria-live`; do not announce every tick/event.
- Forms have persistent labels, inline errors linked with `aria-describedby`, and summary feedback.
- Charts have table alternatives and meaningful units.
- Reduced motion, zoom to 200%, high-contrast/forced-colour mode, and keyboard-only flows are tested.
- Synthetic-agent quotes and predictions are labelled in text, not only in tooltips.

## 10. Performance budgets

### 10.1 Landing page

- LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 under the agreed mid-tier mobile test profile.
- Initial route JavaScript target ≤250 KB gzip excluding a deliberately lazy-loaded visualisation chunk.
- No hero video or multi-megabyte stock image.
- Lazy-load the network component and below-fold sections; keep headline/CTA in semantic HTML.
- Canvas target: stable 30–60 fps on the test device, adaptive node count, no continuous rendering when idle/hidden.
- Fonts are subset/weight-limited and preloaded only when critical.

### 10.2 Application

- Route-level code splitting and virtualised dense lists.
- Query cache scoped by workspace and cleared on identity/workspace changes.
- SSE payloads contain coarse aggregates; full artifacts load on demand.
- Network/report visualisations use representative samples and Web Workers when profiling shows main-thread pressure.
- Performance regressions block release if they break the agreed budgets.

## 11. SEO, sharing, and trust assets

- Title: `CrowdLens — Simulate the crowd before you decide`.
- Description states document-driven scenario analysis and avoids guaranteed prediction language.
- Open Graph image uses the aperture symbol, cohort constellation, and the main headline; no unsupported customer metrics.
- Add `SoftwareApplication` structured data only with accurate, visible pricing/feature information.
- Methodology page explains direct vs surrogate agents, provenance, calibration, provider handling, and limitations.
- Public status page shows real component state only when integrated; otherwise omit it.
- Source licence link, privacy, terms, responsible-use policy, and security contact are reachable from the footer.

## 12. Design acceptance checklist

### Landing

- [ ] Hero observatory is interactive with fixture data and accessible alternatives.
- [ ] Gemini/OpenRouter control changes observable sample state and does not pretend to call an API.
- [ ] All CTAs, anchors, forms, accordions, tabs, and mobile navigation work.
- [ ] No fake customer logos, benchmark numbers, live badges, or unsupported million-agent claim.
- [ ] Credit estimator and plan table agree with `specs.md` configuration.
- [ ] Desktop/mobile screenshots and console/network checks are clean.
- [ ] Keyboard, reduced-motion, contrast, and 200% zoom checks pass.
- [ ] Performance budgets are measured, not assumed.

### Application

- [ ] Five-stage scenario flow works end to end.
- [ ] Provider is pinned after run confirmation; clone supports change.
- [ ] Credit estimate, reservation, settlement, and release are visible.
- [ ] Direct, surrogate, aggregate, and source evidence are distinguishable.
- [ ] Run/report remain usable during reconnect, failure, cancellation, and quota exhaustion.
- [ ] Workspace switch clears tenant-scoped query/UI state.
- [ ] Share revocation and membership removal invalidate protected views.
- [ ] No full-population browser rendering or unbounded event list exists.

Implementation sequencing and engineering acceptance tests are defined in `instructions.md`; cache behaviour and system interfaces are defined in `architecture.md`.
