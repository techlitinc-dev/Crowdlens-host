# CrowdLens — Product Specification

**Document:** `specs.md`  
**Status:** v1.0 — implementation blueprint  
**Date:** 2026-11-09  
**Product name:** CrowdLens  
**Commercial model:** recurring plans plus metered simulation credits  
**Delivery scope:** planning documents only; this document does not claim that the described system has already been implemented

## 1. Product definition

CrowdLens is a multi-tenant decision-intelligence SaaS that turns source documents and a decision question into an explainable, multi-agent scenario simulation. It evolves the local MiroFish-Offline workflow into a secure hosted product with workspaces, durable jobs, subscriptions, usage metering, provider choice, shareable evidence-backed reports, and a path to millions of lightweight logical agents.

**Positioning:** “A million perspectives. One decision you can defend.”

**Primary promise:** help strategy, communications, policy, and research teams explore how different audience segments may react before they publish, launch, or change course.

**Important boundary:** CrowdLens produces scenario analysis, not certainty. A simulation is not a representative survey, a factual forecast, financial advice, or a substitute for human review. Every report must display assumptions, provenance, model configuration, uncertainty, and known limitations.

### 1.1 North-star outcome

A customer can upload evidence, define a decision, run a budget-bounded simulation, and receive a traceable report that changes or validates a real decision.

### 1.2 Product principles

1. **Evidence before eloquence.** Claims link to source passages, simulation events, or clearly labelled model inference.
2. **Budget before execution.** Users see an estimated credit range and set a hard maximum before a run starts.
3. **Scale without waste.** Millions of logical agents must not imply millions of paid LLM calls per tick.
4. **One run, one reproducible configuration.** Provider, model, prompts, embedding profile, source hashes, code version, and random seed are snapshotted.
5. **No invisible inference.** Surrogate/cohort behaviour is visually distinguished from direct LLM reasoning.
6. **Tenant isolation everywhere.** Database rows, graph nodes, objects, queues, caches, logs, exports, and background jobs all carry tenant context.
7. **Monetise outcomes, not confusion.** Pricing and credit consumption are understandable before purchase and auditable afterwards.

## 2. Source baseline and licensing gate

The verified MiroFish-Offline baseline contains:

- Vue 3 + Vite frontend with D3 and Vue Router.
- Flask backend with graph, simulation, and report blueprints.
- Neo4j behind a `GraphStorage` abstraction.
- Ollama through an OpenAI-compatible `LLMClient`.
- OASIS/CAMEL-based social simulations.
- Local JSON/file-backed projects and simulation state.
- In-memory task state and local process management.
- Document types PDF, Markdown, and TXT.
- Workflow stages: graph build, environment setup, simulation, report, and agent interaction.

The current baseline has no hosted authentication, tenant model, subscription entitlement system, distributed queue, object storage, or production cache coherence strategy. These are new control-plane capabilities, not configuration changes.

### 2.1 AGPL-3.0 requirement

MiroFish-Offline is licensed under AGPL-3.0. Section 13 requires a modified version used over a network to offer remote users an opportunity to receive its Corresponding Source. CrowdLens must therefore choose and document one of these routes before public launch:

- **Default route — compliant open hosted fork:** preserve copyright and licence notices, publish the Corresponding Source for the covered modified work, and expose a visible “Source” link in the product.
- **Alternative route — separate commercial rights:** obtain written rights from all relevant copyright holders before treating covered code as closed source.
- **Clean-room route:** do not copy or modify covered code; independently implement against public behaviour and separately licensed components, with legal review.

This is an engineering release gate, not legal advice. Counsel must review the final boundary between any new proprietary services and AGPL-covered code. Payment for hosting and support is compatible with open-source software; secrecy of the modified covered source cannot be assumed.

## 3. Users and jobs to be done

| Persona | Job to be done | Primary value | Permissions |
|---|---|---|---|
| Communications lead | Test a press release or crisis response | Detect objection themes and narrative spread | Create/run/share |
| Product strategist | Compare launch messages or policy options | Segment-level trade-offs and sensitivity analysis | Create/run/share |
| Research analyst | Explore historical or hypothetical scenarios | Reproducible methods and evidence trails | Create/run/export |
| Workspace owner | Control spend, members, providers, and data | Governance and predictable billing | All workspace settings |
| Billing admin | Manage plan, invoices, and credit packs | Clear usage and payment state | Billing only |
| Viewer/executive | Understand a recommendation quickly | Concise report with drill-down evidence | Read/comment |
| CrowdLens operator | Keep the service reliable and profitable | Queue, provider, cost, and tenant observability | Internal admin only |

## 4. Release scope

### 4.1 Launch MVP

- Email/OIDC sign-in and secure workspace membership.
- Roles: Owner, Admin, Analyst, Viewer, Billing Admin.
- Projects, document upload, parsing, graph build, persona generation, simulation, report, and agent interview.
- Gemini Developer API and OpenRouter adapters with an explicit provider/model switch for new runs.
- Server-managed provider keys; optional workspace BYOK after secret-management controls pass review.
- Razorpay test/live configuration, recurring plans, one-time credit packs, webhook processing, and billing portal screens.
- Credit wallet, reservation, settlement, release, and downloadable usage ledger.
- Durable workflow execution and resumable checkpoints.
- PostgreSQL, Neo4j, Redis, and S3-compatible object storage.
- Redis/application/artifact/provider caching specified in `architecture.md`.
- Responsive landing page and application UI specified in `design.md`.
- Up to 100,000 logical agents after load validation; smaller plan-level caps may apply.
- Report sharing through expiring, revocable links.
- Audit log, deletion/export, usage metrics, and operator health dashboard.

### 4.2 Scale release

- Distributed population kernel validated at 1,000,000 logical agents per simulation.
- Multiple seeds and sensitivity analysis.
- Workspace-level data-policy routing and OpenRouter zero-data-retention constraints where supported.
- Enterprise SSO, SCIM, custom retention, dedicated worker pools, and regional deployment options.
- ClickHouse or equivalent analytical store when event volume justifies it.
- Historical replay and calibration notebooks.

### 4.3 Explicit non-goals

- One LLM request per logical agent per tick.
- Claiming that synthetic agents represent real individuals.
- Automatic high-impact decisions about people.
- Guaranteed revenue, forecast accuracy, or virality.
- Mid-run silent provider/model switching.
- Cross-tenant semantic caches.
- Public anonymous access to private reports or source documents.
- Building a custom payments ledger as a replacement for statutory accounting or tax invoices.

## 5. Core user journeys

### 5.1 Create and run a scenario

1. Analyst selects a workspace and creates a project.
2. Analyst uploads one or more supported documents or enters text.
3. System validates type, size, malware status, tenant quota, and extraction result.
4. Analyst states the decision question, target audience, desired platforms, and assumptions.
5. System builds or reuses a content-addressed graph artifact where valid.
6. Analyst chooses agent population, reasoning depth, tick count, random-seed policy, provider, model class, and maximum credits.
7. System returns an estimated credit range and identifies the largest cost drivers.
8. Analyst confirms; system creates an idempotent run and reserves credits.
9. Worker checkpoints graph, population, shard, tick, usage, and report state.
10. UI streams coarse progress and selected events; it does not push millions of rows to the browser.
11. System settles actual usage, releases unused reservation, and publishes the report.
12. Analyst compares segments, inspects evidence, interviews selected active agents, and exports or shares the report.

### 5.2 Change simulation provider

1. Admin opens **Workspace → AI providers**.
2. Admin chooses **Gemini (AI Studio key)** or **OpenRouter**.
3. System validates server-side credentials and displays eligible models and data-policy capabilities.
4. Analyst chooses provider/model while configuring a new run.
5. System snapshots that choice into the run.
6. Changing workspace defaults never mutates a running or historical simulation.
7. A failed run may be cloned with another provider; automatic mid-run cross-provider failover is off by default.

### 5.3 Purchase and consume credits

1. Billing Admin selects a plan or credit pack.
2. Backend creates the Razorpay subscription or order; browser opens Checkout with server-issued values.
3. Browser confirmation improves UX but does not grant entitlement by itself.
4. Signed webhook is durably recorded and processed idempotently; urgent status may be verified through Razorpay’s API.
5. Credit ledger posts plan grant or top-up exactly once.
6. A run reserves its maximum authorised credits.
7. Metering records actual usage by rate-card version.
8. Settlement debits actual credits and releases the remainder.
9. Failed/cancelled runs settle consumed work and release unused holds; users receive an itemised explanation.

## 6. Functional requirements

### 6.1 Identity, workspaces, and projects

| ID | Requirement | Acceptance evidence |
|---|---|---|
| ACC-01 | Users authenticate through the selected OIDC provider; backend establishes a secure HttpOnly session. | Unauthenticated API and direct object access fail; session revocation works. |
| ACC-02 | A user may belong to multiple workspaces and must explicitly switch context. | No resource from workspace A appears in workspace B, including cached responses. |
| ACC-03 | RBAC enforces Owner, Admin, Analyst, Viewer, and Billing Admin permissions server-side. | Every role is tested against every sensitive route and job type. |
| ACC-04 | Membership removal takes effect for API, SSE, shares owned by the user, and cached data. | Revocation test passes within 60 seconds; privileged cache entries are invalidated immediately. |
| PRJ-01 | Projects have ordered stages and durable status. | Refresh/restart does not lose project state. |
| PRJ-02 | Every list API is paginated and tenant-scoped. | No unbounded `list all` endpoint remains. |
| PRJ-03 | Delete/export includes documents, graph artifacts, simulations, reports, cached derivatives, and audit status. | Deletion tombstone and asynchronous purge report are visible. |

### 6.2 Documents and knowledge graph

| ID | Requirement | Acceptance evidence |
|---|---|---|
| DOC-01 | Accept PDF, MD, TXT initially; limits are configurable per plan. | Oversize, encrypted, malformed, and unsupported files receive actionable errors. |
| DOC-02 | Store originals in private object storage, never public repositories or database blobs. | Bucket policy and signed-URL tests pass. |
| DOC-03 | Hash content and parser version to enable safe parse reuse. | Identical content in the same tenant reuses parsing; another tenant cannot access that artifact. |
| DOC-04 | Extraction retains source locators such as page/chunk IDs. | A report citation opens the relevant source excerpt. |
| GRP-01 | Graph builds are durable, idempotent jobs. | Duplicate submission returns the same job; worker retry does not duplicate nodes. |
| GRP-02 | Embedding profile and dimensions are versioned per graph. | Switching chat provider never silently mixes vector spaces. |
| GRP-03 | Graph access is scoped by tenant and project. | Cross-tenant Cypher/API/object tests return not found. |

### 6.3 Simulation and population

| ID | Requirement | Acceptance evidence |
|---|---|---|
| SIM-01 | Run configuration is schema-validated and snapshotted. | Historical run displays exact provider, model, prompts, seed, and rate card. |
| SIM-02 | Run states are `draft → queued → preparing → running → finalizing → completed`, with `paused`, `failed`, and `cancelled` branches. | Illegal transitions are rejected and audited. |
| SIM-03 | Every long-running activity checkpoints and supports safe retry. | Killing a worker resumes from the last valid checkpoint without duplicate billing. |
| SIM-04 | UI receives sampled progress and aggregates, not the full agent/event firehose. | Browser memory remains bounded during the scale test. |
| SIM-05 | Users can stop a run; workers honour cancellation between units of work. | Unused reservation is released and final status is accurate. |
| SIM-06 | Multiple seeds can be compared without claiming statistical significance below the configured sample threshold. | Report exposes run-to-run variance. |
| SIM-07 | Agent interviews identify whether the agent was direct-LLM or surrogate-inferred. | UI and exported report include this provenance. |
| SIM-08 | A simulation never exceeds its hard credit cap. | Provider retries and worker races cannot push the ledger below the permitted balance. |

### 6.4 Reports and collaboration

| ID | Requirement | Acceptance evidence |
|---|---|---|
| RPT-01 | Report contains executive summary, segment reactions, timeline, influential narratives, objections, opportunities, risks, method, and limitations. | Golden fixture validates all required sections. |
| RPT-02 | Material claims link to source evidence, aggregated events, or labelled model inference. | Unsupported claims are flagged rather than presented as sourced. |
| RPT-03 | Reports are immutable versions; regeneration creates a new version. | Old share links resolve to the intended version. |
| RPT-04 | Export supports print/PDF and structured JSON/CSV aggregates. | Exports contain method and provenance metadata. |
| RPT-05 | Share links expire, can be revoked, and expose only selected report content. | Revoked/expired links cannot retrieve cached private data. |
| RPT-06 | Agent interview responses disclose simulation provenance and cannot be mistaken for real-person testimony. | Standard disclaimer and agent type are visible. |

### 6.5 Operations and administration

| ID | Requirement | Acceptance evidence |
|---|---|---|
| OPS-01 | Operators can inspect queue depth, active shards, provider health, credit anomalies, webhook failures, and cache hit rates. | Staging failure drills create actionable alerts. |
| OPS-02 | Audit logs cover membership, provider settings, billing changes, runs, exports, shares, and deletion. | Logs are append-only and access-controlled. |
| OPS-03 | Provider/model catalogs are server-managed allowlists, not arbitrary browser strings. | Unknown model or provider is rejected. |
| OPS-04 | Plan limits and credit rate cards are versioned configuration. | Historical usage remains explainable after a pricing change. |
| OPS-05 | A kill switch pauses new runs without losing existing checkpoints. | Recovery drill resumes safely. |

## 7. Million-agent scale contract

### 7.1 Terminology

- **Logical agent:** a lightweight state record with persona attributes, stance, activity, influence, relationships, and memory references.
- **Active reasoning agent:** a logical agent selected for direct LLM reasoning during a tick.
- **Surrogate agent:** an agent updated through deterministic or learned cohort rules rather than a direct LLM call for that tick.
- **Cohort:** a group of agents sharing relevant behavioural features; aggregate outcomes are propagated with stochastic variation.
- **Shard:** an independent partition of population state and interactions with a bounded checkpoint and event stream.

### 7.2 Required execution model

1. Generate population profiles in batches and store compact, columnar state.
2. Partition by network/community and processing shard.
3. Select a bounded active subset using influence, novelty, controversy, segment coverage, and random sampling.
4. Use direct LLM calls only for that subset and for high-value report/interview work.
5. Update remaining agents through cohort/state-transition rules.
6. Aggregate events per segment/shard/tick; persist raw high-volume events to chunked storage only when required.
7. Checkpoint population state independently of workflow history.
8. Run multiple seeds for sensitivity analysis instead of treating one synthetic trajectory as truth.

### 7.3 Scale acceptance target

Before public “million-agent” claims, a production-like load test must demonstrate:

- 1,000,000 logical agents in one scenario.
- At least 32 shards, or a documented equivalent partitioning.
- A configurable active-reasoning budget that remains bounded as logical population grows.
- 24 simulated ticks with checkpoint/restart and one forced worker failure.
- No cross-tenant data or cache hits.
- Browser memory and network use remain bounded independent of total population.
- Actual infrastructure/provider cost and runtime are recorded and used to set plan caps.
- Aggregates reconcile across shards, and no agent is double-counted.

No fixed completion-time promise is approved until this benchmark exists.

## 8. AI provider-switch contract

### 8.1 Provider definitions

- **Gemini:** Gemini Developer API, using credentials created/managed through Google AI Studio. “Google AI Studio” is not implemented as a separate runtime provider.
- **OpenRouter:** OpenRouter API with workspace-approved models and endpoint routing policy.
- **Embeddings:** a separate versioned profile. Launch may retain server-managed Ollama embeddings for both chat routes; adding Gemini embeddings creates a new embedding profile rather than mutating existing graphs.

### 8.2 Behavioural requirements

| Area | Required behaviour |
|---|---|
| Scope | Workspace default plus per-new-run override, subject to admin allowlist. |
| Immutability | Provider/model snapshot remains fixed for a run unless the user explicitly clones it. |
| Structured output | Use JSON Schema where supported and validate every response locally against Pydantic schemas. |
| OpenRouter routing | Set `require_parameters: true` for structured workflows; configure data collection and ZDR policy according to workspace plan. |
| Failover | Same-model endpoint fallback may occur inside OpenRouter; cross-provider failover is disabled mid-run by default. |
| Cost | Record input, cached input, output, request, and other available usage fields; mark estimates if exact usage is absent. |
| Privacy | Keys stay server-side, are redacted from logs, and are never returned by provider-settings APIs. |
| Models | Retrieve/refresh a server catalog; never hardcode a “latest” model into prompts or UI. |
| Prompt caching | Keep stable instruction/source prefixes; provider caching is opportunistic and never required for correctness. |
| Reproducibility | Provider responses may still vary; seed and configuration improve reproducibility but do not guarantee bit-identical output. |

## 9. Subscriptions and simulation credits

### 9.1 Launch pricing hypotheses

These are testable starting points, not claims of market validation. Prices and included credits must be configuration, with tax treatment reviewed before launch.

| Plan | Illustrative price | Included credits | Logical-agent ceiling* | Seats | Other limits |
|---|---:|---:|---:|---:|---|
| Explorer | ₹0 | 300 one-time | 10,000 | 1 | 1 active project; no concurrency |
| Professional | ₹4,999/month | 2,500/month | 100,000 | 3 | 2 concurrent runs |
| Business | ₹19,999/month | 12,000/month | 1,000,000 after scale gate | 10 | 5 concurrent runs; priority queue |
| Enterprise | Custom | Contracted | Contracted and benchmarked | Custom | SSO, retention, dedicated capacity options |

\*Ceilings describe lightweight logical agents, not simultaneous direct-LLM agents. Direct reasoning is separately capped by credits and workspace policy. Annual billing may offer ten monthly payments per year after unit economics are validated.

### 9.2 Razorpay mapping

- **Recurring plan:** Razorpay Plan + Subscription + hosted Checkout.
- **One-time credit pack:** Razorpay Order + Payment; never model a top-up as a new recurring subscription.
- **Plan grant:** ledger entry keyed to the unique subscription billing event/invoice.
- **Top-up grant:** ledger entry keyed to the paid order/payment after server verification.
- **Cancellation:** initial launch cancels at the end of the paid cycle where supported; entitlement remains until that boundary.
- **Upgrade/downgrade:** launch default applies at the next billing boundary. Proration is not assumed until separately implemented and tested.
- **Failed renewal:** enter a configurable grace period, stop new paid runs, preserve existing reports, and never delete data immediately.

### 9.3 Wallet and ledger rules

1. Credits are internal usage units, not cash, cryptocurrency, stored value, or transferable balances.
2. Wallet balance is derived from immutable ledger entries; cached balances are projections only.
3. Entry types: `plan_grant`, `topup_grant`, `reservation`, `reservation_release`, `usage_debit`, `adjustment`, `expiration`.
4. Every entry has workspace, currency-independent credit amount, idempotency key, rate-card version, actor/event reference, and timestamp.
5. Monthly included credits are consumed before non-expiring top-up credits.
6. Top-up expiry is disabled by default unless local law and published terms explicitly allow it.
7. Reservation is atomic and must include a safety margin for the selected hard cap.
8. Actual usage is calculated from versioned rates for graph work, active reasoning, logical-agent ticks, storage-heavy exports, and report generation.
9. The estimate and rate card are shown before confirmation; no hidden multipliers.
10. Credits cannot go negative because of concurrent runs; database constraints/serialisable ledger operations are authoritative.
11. Support adjustments reference a reason and operator; they never edit old entries.
12. Razorpay remains payment evidence; CrowdLens’s ledger explains consumption. Both reconcile.

### 9.4 Billing acceptance tests

- Duplicate, delayed, and out-of-order webhooks do not duplicate grants or corrupt subscription state.
- Webhook signature uses the raw request body and a constant-time comparison.
- Browser success without verified server payment does not grant credits.
- A paid top-up after a browser crash is still granted by webhook/reconciliation.
- Two concurrent runs cannot reserve the same credits.
- Worker retry cannot double-debit usage.
- Cancellation, failed renewal, pause/resume, and plan change preserve correct entitlements.
- Cache invalidation after billing events is observable within 60 seconds and immediate where revocation is required.
- Refund/chargeback handling creates an auditable adjustment according to published policy.

## 10. Caching product requirements

Detailed keys, TTLs, invalidation, pseudocode, and tests live in `architecture.md`.

- Repeated document parsing, graph extraction, model catalogs, immutable reports, and safe deterministic LLM tasks should be reusable.
- Cache keys include tenant, authorisation scope, source hash, model/provider, prompt/schema version, and relevant configuration.
- Live simulation state is event-driven or very short-lived; users must not see a completed run as running because of a long TTL.
- Entitlement caches are short-lived and versioned; payment/revocation events invalidate them.
- Semantic response caching is off by default and may never cross tenants.
- Cache failure must not become data loss or unauthorised access. Redis is never the source of truth.
- Users see “cached/reused artifact” only when this aids transparency; internal implementation details are not exposed.

## 11. Landing page and application UX

The full experience specification is in `design.md`. Required public-page content:

1. Left-aligned hero with an embedded live-product-style scenario observatory.
2. Headline: **“A million perspectives. One decision you can defend.”**
3. Supporting copy that states document-to-scenario workflow without promising prediction certainty.
4. Primary CTA **“Run a scenario”** and secondary CTA **“Explore a sample report”**.
5. Interactive sample with fixture data; no fake live API or fabricated customer metrics.
6. Workflow, segment analysis, report evidence, provider choice, scale explanation, security, pricing/credit estimator, FAQ, and final CTA.
7. Honest labels for “up to” limits, waitlist/beta state, and simulated examples.
8. Source-code link satisfying the selected licensing route, privacy, terms, and contact.

Every visible control must have a real destination or action. Mobile, keyboard, reduced-motion, empty, loading, error, and exhausted-credit states are release requirements.

## 12. Business and measurement plan

“Million-dollar SaaS” is treated as an operating target, not a guaranteed result. **$1M ARR equals approximately $83,333 MRR.** The roadmap must optimise retention, gross margin, and decision value rather than agent count alone.

### 12.1 Funnel metrics

- Visitor → workspace creation.
- Workspace creation → first valid document.
- First document → first completed report (**activation**).
- First report → second simulation within 30 days (**habit**).
- Free → paid, monthly → annual, Professional → Business.
- Credit-pack attach rate and expansion MRR.
- Logo and revenue churn by cohort.

### 12.2 Unit-economics guardrails

- Gross margin target: ≥70% after model, worker, database, storage, and payment variable costs.
- Every run records estimated vs actual provider and infrastructure cost.
- No unlimited plan while active-reasoning cost remains variable.
- Provider routing may optimise price only inside quality/data-policy constraints.
- Low-margin scenarios trigger rate-card or product changes, not hidden throttling.
- Weekly reconciliation: payment grants, credit debits, provider invoices, worker cost, refunds, and anomalies.

### 12.3 Product-quality metrics

- Report usefulness rating and decision influence.
- Percentage of material claims with inspectable provenance.
- Simulation completion, resume, cancellation, and settlement success.
- Median/p95 queue wait and stage duration by scenario class.
- Cache hit ratio and provider cached-token share by operation, without tenant labels in metrics.
- Calibration error on available historical/survey benchmarks.

## 13. Non-functional requirements

| Category | Launch target |
|---|---|
| Availability | 99.9% monthly for control-plane APIs; simulation worker availability measured separately. |
| Metadata latency | p95 read <400 ms and write <800 ms at agreed launch load, excluding third-party calls. |
| Run submission | p95 accepted/queued response <1 second after validation and reservation. |
| Live updates | p95 coarse progress visible within 2 seconds of durable event publication. |
| Durability | No completed report or ledger loss after a single worker failure. |
| Recovery | RPO ≤5 minutes and RTO ≤60 minutes for launch infrastructure. |
| Accessibility | WCAG 2.2 AA target for core workflows and landing page. |
| Browser | Current two major versions of Chrome, Edge, Firefox, and Safari; responsive at 375/768/1024/1440 px. |
| Observability | Structured logs, traces, metrics, request/run IDs, and redaction. No tenant IDs in high-cardinality metric labels. |
| Data lifecycle | Configurable retention, verified deletion, encrypted transport/storage, and backup restore drills. |
| Safety | Abuse controls, sensitive-attribute restrictions, prompt-injection isolation, and human review messaging. |

## 14. Security, privacy, and responsible simulation

- Tenant ID comes from verified server-side membership, never a client-supplied header alone.
- PostgreSQL row-level security supplements service-level authorisation; graph and object access have equivalent controls.
- Uploaded content is untrusted. Strip active content, scan files, isolate parsers, and treat document instructions as data rather than system commands.
- Provider prompts contain only necessary source excerpts; honour workspace data-policy settings.
- Secrets live in a managed secret store; BYOK values are envelope-encrypted and write-only after creation.
- Signed URLs are short-lived; sharing never exposes original uploads unless explicitly authorised.
- No raw document bodies, keys, payment secrets, or full prompts in ordinary logs.
- Reports avoid identifying or targeting real vulnerable individuals. Aggregate sensitive segments and prohibit manipulative personalised campaigns.
- High-impact domains require a visible human-review warning; launch excludes automated credit, employment, insurance, policing, or medical decisions.
- Terms and report UI disclose synthetic behaviour, data sources, limitations, and retention.

## 15. Release acceptance scenario

The MVP is accepted only when this vertical slice passes in a production-like environment:

1. Two separate workspaces and five roles are created.
2. Each workspace uploads a different confidential document and runs the same scenario template.
3. One run uses Gemini; the other uses OpenRouter with structured output.
4. Billing test mode grants a plan and a top-up through verified webhooks.
5. A duplicate webhook, worker restart, Redis restart, and provider timeout occur during the runs.
6. Both runs resume or fail honestly, settle credits once, and produce evidence-linked reports.
7. Neither workspace can access the other’s API data, graph, objects, shares, cache entries, or agent interviews.
8. A member is revoked; access and cached responses cease within the specified bound.
9. A report share is revoked and stops working despite intermediary caches.
10. Usage, payment, and provider-cost reconciliation is inspectable by an operator.
11. Desktop/mobile, keyboard, reduced-motion, console-error, and network-failure checks pass.
12. The AGPL source-offer route is visible and reviewed.

## 16. Delivery sequence

1. **Foundation:** licence route, monorepo, auth/tenancy, PostgreSQL, object storage, secrets, CI, observability.
2. **Durable engine:** workflow orchestration, document/graph migration, provider abstraction, checkpoints, usage events.
3. **Commercial loop:** Razorpay, ledger, entitlements, credits, billing UI, reconciliation.
4. **Product loop:** simulation UI, reports, interviews, sharing, exports, caching, admin.
5. **Launch experience:** landing page, sample report, pricing estimator, docs, accessibility, security tests.
6. **Scale:** cohort/surrogate kernel, shards, benchmark gates, calibration, enterprise controls.

Do not begin with a million-agent rewrite before the single-tenant workflow is durable, billable, testable, and tenant-safe.

## 17. Decisions locked for implementation

- Preserve Vue expertise by migrating the existing Vue frontend to Nuxt + TypeScript; do not rewrite to React without a new requirement.
- Add a TypeScript control plane and retain Python for simulation/graph/report workers.
- Use durable workflows and coarse shard activities, not one workflow activity per agent action.
- Use subscriptions for plans and one-time orders for top-ups.
- Pin provider/model per run and embedding profile per graph.
- Treat credits, cache, and tenant isolation as core domain logic from day one.
- Build the impressive landing page only after its sample data and CTAs are honest and functional.

Detailed implementation rules are in `instructions.md`; system design is in `architecture.md`; user experience is in `design.md`.

## 18. Official references

Accessed 2026-11-09. Model capabilities, prices, limits, and API fields must be revalidated during implementation rather than copied into permanent configuration.

- [MiroFish-Offline repository](https://github.com/nikmcfly/MiroFish-Offline)
- [GNU AGPL-3.0, including Section 13](https://www.gnu.org/licenses/agpl-3.0.en.html)
- [Razorpay Subscriptions API](https://razorpay.com/docs/api/subscriptions/)
- [Razorpay Webhooks](https://razorpay.com/docs/webhooks/)
- [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test)
- [Gemini API context caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini API structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)
- [OpenRouter structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- [OpenRouter prompt caching](https://openrouter.ai/docs/features/prompt-caching)
