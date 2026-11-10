# Infra

`docker-compose.yml` provisions the production-shaped local dependencies:
PostgreSQL 16 (RLS-capable), Redis 7, Neo4j 5 Community, MinIO (S3-compatible),
and Temporal.

The development machine used for the initial implementation has no Docker;
the verified local path therefore runs:

- **PostgreSQL**: `embedded-postgres` (real PG binaries, real RLS) via `EMBEDDED_PG_DATA_DIR`.
- **Cache**: in-memory versioned cache adapter (Redis is derived state only; correctness never depends on it). Set `REDIS_URL` to use a real server.
- **Object storage**: filesystem adapter under `.data/objects`. Set `S3_ENDPOINT` for S3/MinIO.
- **Graph store**: PostgreSQL tables (`graph_nodes`/`graph_edges`) behind the
  `GraphStorage` port — the same tables RLS protects for tenancy. Set
  `NEO4J_URI` for the Neo4j adapter.
- **Workflow execution**: Postgres-persisted durable runner (coarse activities,
  heartbeats, idempotent retries). Temporal activities are designed to the same
  coarse contract; wire `TEMPORAL_ADDRESS` when a Temporal service is available.

## Windows prerequisite for embedded-postgres

`embedded-postgres` ships native PostgreSQL binaries that need the MSVC runtime.
If initdb exits with `0xC0000135`, copy the runtime DLLs next to the binaries:

```powershell
$dst = "node_modules\.pnpm\@embedded-postgres+windows-x64@*\node_modules\@embedded-postgres\windows-x64\native\bin"
$src = "C:\Program Files (x86)\Microsoft\EdgeCore\*\"
Copy-Item "$src\vcruntime140.dll" "$src\vcruntime140_1.dll" "$src\msvcp140.dll" "$src\msvcp140_codecvt_ids.dll" $dst
```

(any locally installed `vcruntime140.dll`/`msvcp140.dll` source works — the
EdgeCore path above is just one that is present on stock Windows 11.)

These deviations are local-environment conveniences only; tenancy, ledger, and
cache-correctness invariants are identical on both paths because they live in
PostgreSQL and validated code, not in the adapters.
