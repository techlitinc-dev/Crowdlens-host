# CrowdLens — Project Summary

Source-grounded, multi-agent scenario analysis delivered as a multi-tenant SaaS:
upload an announcement, policy, or launch plan; CrowdLens parses it, builds a
per-tenant entity graph, generates a synthetic population (bounded direct LLM
reasoning over columnar cohorts), runs the narrative across segments, and
produces an evidence-linked report with visible provenance on every claim.
Evolution of MiroFish-Offline (AGPL-3.0 open-fork route, `legacy/NOTICE.md`).

## Stack

| Layer | Technology |
|---|---|
| Control plane | NestJS 10 (TypeScript, strict), PostgreSQL 16 with forced row-level security |
| Simulation | Python 3.11+ workers (numpy columnar kernel), durable Postgres work-queue |
| Web | Nuxt 4 (Vue 3, SSR landing, client-rendered app), `@crowdlens/ui` design tokens |
| Contracts | JSON Schema + zod (TS) + Pydantic (Py) parity, canonical-JSON SHA-256 fingerprints |
| Billing | Immutable integer-credit ledger, reservations, Razorpay webhook inbox |
| Cache | Versioned tenant keys, generations, single-flight; in-memory default, optional Redis |

## Repository layout

```
apps/control-api     NestJS REST API: auth/sessions, workspaces, projects, documents,
                     graph, simulations (+SSE/polling), billing/ledger, Razorpay webhooks,
                     providers (Gemini/OpenRouter/mock + BYOK), reports/shares/interviews,
                     versioned cache, durable runner, settlement reconciler
apps/web             Nuxt 4: landing (hero observatory, sections I–VII, estimator, FAQ),
                     /sample-report, /app/:workspace/* (builder, observatory, report,
                     interview, usage, settings), /shared/:token public share view
services/graph-worker        parse (PDF/MD/TXT) + NER/theme extraction -> graph tables
services/simulation-worker   hybrid population kernel + checkpoints + usage records
services/report-worker       evidence-linked report assembly + interviews
packages/contracts           schemas/types/fingerprints (TS + Python, golden vectors)
packages/ui                  tokens.css (design.md §2) + ClButton/ClChip/ClPanel
packages/observability       redacting structured logger
infra/compose                Docker deps + verified no-Docker local path notes
```

## Key design decisions

- **Tenancy**: app role `crowdlens_app` (no RLS bypass); every request carries
  `x-workspace-id`; membership re-verified per request via SECURITY DEFINER
  function → revocation is immediate; fail-closed policies elsewhere.
- **Money**: estimate → reserve (wallet-row lock) → settle actual → release
  remainder; every ledger entry records its rate-card version; idempotency keys
  everywhere; webhooks land in a durable inbox (HMAC-SHA256, constant-time)
  before async, idempotent processing.
- **Cache (architecture §12)**: key grammar `cl:1:<tenant_hash>:<scope>:<op>:<fingerprint>`
  with generations bumped in the same transaction as writes; share revocation
  deletes keys immediately and seeds negatives; store failures fall back to the
  source of truth.
- **Simulation**: work-queue stages with leases (expired leases are reclaimable —
  fixed during validation), per-shard checkpoints to object storage, PRNG streams
  keyed `(run_seed, shard, tick, salt)` so retried ticks are deterministic,
  ACTION_BATCH=8 agents per provider call (estimator mirrors it).

## Local quick start (no Docker, no keys)

```bash
pnpm install
cd apps/control-api && EMBEDDED_PG_DATA_DIR=../../.data/pg STORAGE_FS_DIR=../../.data/objects pnpm dev   # :4000, boots embedded PG (real RLS)
cd services/graph-worker       && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m graph_worker
cd services/simulation-worker  && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m simulation_worker
cd services/report-worker      && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m report_worker
cd apps/web && pnpm dev                                                                                  # :3000, proxies /v1
```

Sign in with any email (development identity), create a workspace, upload a
document, build the graph, estimate and run. Windows note for embedded
PostgreSQL: `infra/compose/README.md`.

## Verification results (all green)

- Typecheck: all packages (`tsc` + `vue-tsc` + `nuxt build` + API build).
- Unit: 39/39 TS (contracts 11, observability 4, cache 15, billing math 6,
  state machine 3) + 7/7 Python kernel tests + 10/10 Python contract parity.
- Integration (embedded Postgres + full app): 10/10 — two-tenant isolation,
  revocation immediacy, webhook HMAC valid/invalid/duplicate, no stale
  entitlement after grant, share revocation beats cache, deletion invalidation.
- E2E smoke: parse → graph → estimate → run (132 credits, cap protected the
  wallet) → report → share view/revoke → interview with provenance disclosure.
- Bounded validation: 100k logical × 24 ticks in 10.5 s (~8 MB heap); plan
  ceiling enforced (422 above 10k on Explorer); kill-resume: worker killed at
  tick 6, reclaimed after fix, completed with exactly-once settlement
  (1 usage_debit, 6,500 usage records, zero duplicates).

## Bugs the verification found and fixed

1. Work-queue lease reclaim never happened (both claim queries) — a killed
   worker stalled its run permanently.
2. Public share view 404'd under fail-closed RLS — capability lookup now runs
   on the owner pool (hashed bearer token is the credential), report read stays
   RLS-scoped, content hash verified.
3. Webhook `jsonb` payload parsed as raw string.
4. Entitlement projection could serve a stale balance (RLS-hidden wallet
   version + memoized generation).
5. Graph worker serialization (`model_dump` on dicts) — smoke now waits for
   graph completion and asserts nodes > 0.
6. Missing `x-workspace-id` produced a 500 on uuid casts — now 403 with an
   explicit allowlist for workspace-list/create/auth probes.
7. `fingerprintSync` used CJS `require` — breaks under tsx ESM; now uses
   `process.getBuiltinModule` with CJS fallback.

## Honest limits / remaining work

- Gemini/OpenRouter adapters follow the data-policy contract but were never
  executed against live APIs (no keys); only the deterministic mock provider is
  exercised locally. Razorpay live mode untouched — checkout returns
  `billing-not-configured` without keys.
- 100k-scale claim rests on the kernel benchmark; the Explorer plan caps API
  runs at 10k agents, and the full 1M-logical × 32-shard production gate needs a
  load environment.
- Exact-safe LLM response caching: key grammar + sensitivity built and tested,
  not wired into a hot path (workers call providers in-process); deferred to a
  provider-proxy milestone.
- Production hardening: statement timeouts on worker transactions (an orphaned
  duplicate worker can deadlock its twin instead of failing fast), optional
  Playwright browser suite.
- Do not run `pnpm -r build` while `nuxt dev` is running (concurrent builds
  corrupt the dev server's `.nuxt`).
