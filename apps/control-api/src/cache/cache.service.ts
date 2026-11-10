import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import pg from "pg";
import { fingerprintSync, type CanonicalValue } from "@crowdlens/contracts";
import { PG_APP_POOL } from "../db/pg.module.js";
import { CACHE_STORE, type CacheStore } from "./cache-store.js";

/**
 * Versioned tenant cache (architecture.md §12).
 *
 * Key grammar (§12.2):
 *   cl:<schema_version>:<tenant_hash>:<scope>:<operation>:<fingerprint>
 * with fingerprint = SHA-256(canonical_json(normalised input)). The raw
 * workspace id, prompts, source text, emails and tokens never appear in keys
 * or logs — only salted hashes and semantic fingerprints.
 *
 * Coherence (§12.6): domain writes bump a `cache_versions` generation row in
 * the SAME database transaction as the source-of-truth write; the generation
 * is part of the fingerprint input, so stale keys simply stop being read.
 * Security-sensitive revocations additionally delete the exact key (share
 * views) so revocation is effective immediately, never after a TTL.
 *
 * Single-flight (§12.5): concurrent identical misses join one in-flight load;
 * the leader writes the value, joiners reuse its promise. Billing, ledger
 * settlement, membership revocation and payment grants bypass this entirely
 * and use database transactions — single-flight never replaces transactional
 * correctness.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger("cache");
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly generationMemo = new Map<string, { version: number; at: number }>();
  private readonly stats = new Map<string, { hits: number; misses: number; joins: number; bypasses: number }>();

  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CACHE_STORE) private readonly store: CacheStore,
  ) {}

  // ---------- key grammar ----------

  keyFor(scope: string, operation: string, input: CacheKeyInput = {}): string {
    const material = input.workspaceId ?? input.keyMaterial ?? "global";
    const tenantHash = createHash("sha256").update(material).digest("hex");
    const canonical: Record<string, CanonicalValue> = {};
    if (input.workspaceId) canonical.workspace_id = input.workspaceId;
    if (input.authzEpoch !== undefined) canonical.acl_epoch = input.authzEpoch;
    if (input.operationVersion) canonical.operation_version = input.operationVersion;
    if (input.provider) canonical.provider = input.provider;
    if (input.modelId) canonical.model_id = input.modelId;
    if (input.promptBundle) canonical.prompt_bundle = input.promptBundle;
    if (input.schemaHash) canonical.schema_hash = input.schemaHash;
    if (input.sourceHashes) canonical.source_hashes = [...input.sourceHashes].sort();
    if (input.parameters) canonical.parameters = input.parameters as CanonicalValue;
    if (input.randomSeed) canonical.random_seed = input.randomSeed;
    if (input.generations) {
      const gens: Record<string, CanonicalValue> = {};
      for (const [scopeName, version] of Object.entries(input.generations).sort()) {
        gens[scopeName] = version;
      }
      canonical.generations = gens;
    }
    if (input.keyMaterial) canonical.key_material = input.keyMaterial;
    const fingerprint = fingerprintSync(canonical);
    return `cl:1:${tenantHash}:${scope}:${operation}:${fingerprint}`;
  }

  // ---------- generations (cache_versions) ----------

  /**
   * Current generation for a tenant scope. Reads through a short in-process
   * memo: correctness-critical freshness (membership) travels in the key via
   * the always-fresh authz epoch from the auth guard, while domain generations
   * may be memoised for a few seconds — far inside every cache TTL.
   */
  async generation(workspaceId: string, scope: string, memoMs = 5_000): Promise<number> {
    if (!workspaceId) return 0; // no tenant context (fail-closed paths elsewhere)
    const memoKey = `${workspaceId}:${scope}`;
    const memo = this.generationMemo.get(memoKey);
    if (memo && memo.at + memoMs > Date.now()) return memo.version;
    const { rows } = await this.pool.query<{ version: number }>(
      `SELECT version FROM cache_versions WHERE workspace_id = $1 AND scope = $2`,
      [workspaceId, scope],
    );
    const version = Number(rows[0]?.version ?? 0);
    this.generationMemo.set(memoKey, { version, at: Date.now() });
    return version;
  }

  /** Bump a generation inside the caller's transaction (same-tx coherence). */
  async bumpGeneration(client: pg.PoolClient, workspaceId: string, scope: string): Promise<number> {
    const { rows } = await client.query<{ version: number }>(
      `INSERT INTO cache_versions (workspace_id, scope, version) VALUES ($1, $2, 1)
       ON CONFLICT (workspace_id, scope) DO UPDATE
         SET version = cache_versions.version + 1, updated_at = now()
       RETURNING version`,
      [workspaceId, scope],
    );
    const version = Number(rows[0]!.version);
    this.generationMemo.set(`${workspaceId}:${scope}`, { version, at: Date.now() });
    return version;
  }

  // ---------- cache-aside with single-flight ----------

  /**
   * Return the cached value for the versioned key, or load it through the
   * single-flight path. A loaded `null` IS cached (negative caching) so a
   * revoked/absent resource stays cheap to re-check for one TTL.
   */
  async through<T>(
    scope: string,
    operation: string,
    input: CacheKeyInput,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = this.keyFor(scope, operation, input);
    const statKey = `${scope}:${operation}`;
    let raw: string | null = null;
    try {
      raw = await this.store.get(key);
    } catch (error) {
      this.bumpStat(statKey, "bypasses");
      this.logger.warn(`store read failed (${statKey}); falling back to source of truth: ${(error as Error).message}`);
    }
    if (raw !== null) {
      this.bumpStat(statKey, "hits");
      return JSON.parse(raw) as T;
    }
    this.bumpStat(statKey, "misses");

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.bumpStat(statKey, "joins");
      return existing;
    }
    const leader = (async () => {
      const value = await load();
      try {
        await this.store.set(key, JSON.stringify(value), ttlMs);
      } catch (error) {
        this.logger.warn(`store write failed (${statKey}); value served uncached: ${(error as Error).message}`);
      }
      return value;
    })();
    this.inflight.set(key, leader);
    try {
      return await leader;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Direct invalidation for security-sensitive revocations (immediate). */
  async invalidate(scope: string, operation: string, input: CacheKeyInput): Promise<void> {
    try {
      await this.store.delete(this.keyFor(scope, operation, input));
    } catch (error) {
      this.logger.warn(`store delete failed (${scope}:${operation}): ${(error as Error).message}`);
    }
  }

  /** Cache a negative result (e.g. revoked share) so dead links stay cheap. */
  async seedNegative(scope: string, operation: string, input: CacheKeyInput, ttlMs: number): Promise<void> {
    try {
      await this.store.set(this.keyFor(scope, operation, input), "null", ttlMs);
    } catch (error) {
      this.logger.warn(`store negative write failed (${scope}:${operation}): ${(error as Error).message}`);
    }
  }

  // ---------- observability (§12.11: by operation, never by tenant) ----------

  private bumpStat(statKey: string, field: "hits" | "misses" | "joins" | "bypasses"): void {
    const entry = this.stats.get(statKey) ?? { hits: 0, misses: 0, joins: 0, bypasses: 0 };
    entry[field] += 1;
    this.stats.set(statKey, entry);
  }

  snapshotStats(): Record<string, { hits: number; misses: number; joins: number; bypasses: number }> {
    return Object.fromEntries(this.stats);
  }
}

export interface CacheKeyInput {
  /** Tenant id; hashed into key material, never logged raw. */
  workspaceId?: string;
  /** Capability material for non-tenant keys (e.g. share token hash). */
  keyMaterial?: string;
  /** Always-fresh ACL epoch from the auth guard (revocation immediacy). */
  authzEpoch?: number;
  /** Version of the operation semantics (catalog/rate-card/parser versions). */
  operationVersion?: string;
  provider?: string;
  modelId?: string;
  promptBundle?: string;
  schemaHash?: string;
  sourceHashes?: string[];
  parameters?: Record<string, CanonicalValue> | CanonicalValue[];
  randomSeed?: string;
  /** Domain generations folded into the fingerprint (§12.6). */
  generations?: Record<string, number>;
}

/** Launch TTLs from the §12.3 matrix. */
export const CACHE_TTLS = {
  catalog: 5 * 60_000,
  providerDefaults: 60_000,
  entitlement: 30_000,
  projectList: 30_000,
  projectDetail: 60_000,
  reportDetail: 24 * 3_600_000,
  graphSearch: 15 * 60_000,
  shareView: 60_000,
} as const;
