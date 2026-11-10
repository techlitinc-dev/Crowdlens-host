# CrowdLens

Source-grounded, multi-agent scenario analysis. Upload an announcement, policy, or
launch plan; CrowdLens builds a source-grounded synthetic population, tests the
narrative across segments, and shows which objections spread — and why, with
evidence links and visible provenance.

This repository is the multi-tenant SaaS evolution of MiroFish-Offline (AGPL-3.0,
`legacy/mirofish-offline`, source-offer route per `legacy/NOTICE.md`).

## Layout

| Path | What |
|---|---|
| `apps/control-api` | NestJS control plane: tenancy (RLS), projects, documents, graph, simulations, billing/ledger, provider gateway, reports, webhooks |
| `apps/web` | Nuxt 4 public site + authenticated app (`/`, `/sample-report`, `/app/:workspace/...`) |
| `services/graph-worker` | Document parsing + entity/theme extraction → `graph_nodes`/`graph_edges` |
| `services/simulation-worker` | Hybrid population kernel (columnar cohorts + bounded direct reasoning) |
| `services/report-worker` | Evidence-linked report assembly + provenance-labelled interviews |
| `packages/contracts` | JSON Schemas + zod (TS) + Pydantic (Python) + canonical-JSON fingerprints |
| `packages/ui` | Design tokens (design.md §2) + Vue primitives |
| `infra/compose` | Docker Compose for production-shaped deps + local-path notes (read this on Windows) |

## Quick start (local, no Docker, no external keys)

Prereqs: Node ≥ 20, pnpm 10, uv (Python). On Windows see
`infra/compose/README.md` for the embedded-Postgres MSVC runtime note.

```bash
pnpm install

# 1. Control API (boots embedded PostgreSQL with real RLS, port 4000)
cd apps/control-api
EMBEDDED_PG_DATA_DIR=../../.data/pg STORAGE_FS_DIR=../../.data/objects pnpm dev

# 2. Python workers (one terminal each; they retry-connect on API restart)
cd services/graph-worker       && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m graph_worker
cd services/simulation-worker  && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m simulation_worker
cd services/report-worker      && EMBEDDED_PG_DATA_DIR=../../.data/pg uv run python -m report_worker

# 3. Web (Nuxt 4, port 3000; proxies /v1 to the API so cookies stay first-party)
cd apps/web && pnpm dev
```

Open http://localhost:3000 — sign in with any email (development identity),
create a workspace, upload a document, build the graph, estimate and run.

## Verification

```bash
pnpm -r run typecheck           # all TypeScript packages
pnpm -r run test                # unit tests (contracts, cache, billing math, state machine)
pnpm test:integration           # embedded-Postgres + full app: tenancy, revocation,
                                # webhook HMAC/entitlement, share revocation, deletion
pnpm test:e2e                   # full smoke: parse → graph → run → report → share → interview
cd services/simulation-worker && uv run pytest -q   # kernel determinism + checkpoint resume
```

CI runs all of the above (`.github/workflows/ci.yml`).

## Honest limits

- Provider adapters for Gemini/OpenRouter are implemented but only the
  deterministic mock provider is exercised locally (no keys in this repo).
- Razorpay checkout/webhook paths are implemented; without keys the API returns
  `billing-not-configured` and the UI says so.
- The 1M-logical × 32-shard production scale gate is pending a load environment;
  the kernel benchmark (`services/simulation-worker/benchmarks/kernel_100k.py`)
  shows 100k × 24 ticks in ~10.5 s with a ~8 MB heap.
