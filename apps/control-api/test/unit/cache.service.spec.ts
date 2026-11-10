/**
 * Cache unit tests (architecture.md §12.11 where they don't need a database):
 *   1. same input/same tenant hits; different tenant misses
 *   3. provider/model/prompt/schema/source/seed changes miss
 *   7. store failure falls back to the source of truth (no corruption, no leak)
 * plus single-flight join behaviour, TTL expiry, and key hygiene (no raw
 * workspace ids or emails in keys).
 */
import { describe, expect, it, beforeEach } from "vitest";
import pg from "pg";
import { CacheService } from "../../src/cache/cache.service.js";
import { InMemoryCacheStore, type CacheStore } from "../../src/cache/cache-store.js";

function fakePool(): pg.Pool {
  return { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
}

function makeService(store: CacheStore = new InMemoryCacheStore()) {
  const service = new CacheService(fakePool(), store);
  return { service, store };
}

describe("cache key grammar (§12.2)", () => {
  it("same input produces the same key", () => {
    const { service } = makeService();
    const a = service.keyFor("projects", "list", { workspaceId: "ws-1", authzEpoch: 3 });
    const b = service.keyFor("projects", "list", { workspaceId: "ws-1", authzEpoch: 3 });
    expect(a).toBe(b);
    expect(a).toMatch(/^cl:1:[a-f0-9]{64}:projects:list:[a-f0-9]{64}$/);
  });

  it("different tenants get different keys (§12.11 test 1)", () => {
    const { service } = makeService();
    const a = service.keyFor("projects", "list", { workspaceId: "ws-a", authzEpoch: 1 });
    const b = service.keyFor("projects", "list", { workspaceId: "ws-b", authzEpoch: 1 });
    expect(a).not.toBe(b);
  });

  it("acl epoch change (revocation) changes the key (§12.11 test 2)", () => {
    const { service } = makeService();
    const before = service.keyFor("projects", "list", { workspaceId: "ws-1", authzEpoch: 4 });
    const after = service.keyFor("projects", "list", { workspaceId: "ws-1", authzEpoch: 5 });
    expect(before).not.toBe(after);
  });

  it("provider/model/prompt/schema/source/seed changes miss (§12.11 test 3)", () => {
    const { service } = makeService();
    const base = {
      workspaceId: "ws-1",
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      promptBundle: "prompts-a",
      schemaHash: "schema-a",
      sourceHashes: ["src-1", "src-2"],
      randomSeed: "42",
    };
    const baseKey = service.keyFor("llm", "exact", base);
    const variants = [
      { ...base, provider: "openrouter" },
      { ...base, modelId: "gemini-2.5-pro" },
      { ...base, promptBundle: "prompts-b" },
      { ...base, schemaHash: "schema-b" },
      { ...base, sourceHashes: ["src-1", "src-3"] },
      { ...base, randomSeed: "43" },
    ];
    for (const variant of variants) {
      expect(service.keyFor("llm", "exact", variant)).not.toBe(baseKey);
    }
    // Order of source hashes must not matter (canonicalised).
    expect(service.keyFor("llm", "exact", { ...base, sourceHashes: ["src-2", "src-1"] })).toBe(baseKey);
  });

  it("generation bumps change the key (§12.6 coherence)", () => {
    const { service } = makeService();
    const v1 = service.keyFor("projects", "detail", { workspaceId: "ws-1", generations: { projects: 1 } });
    const v2 = service.keyFor("projects", "detail", { workspaceId: "ws-1", generations: { projects: 2 } });
    expect(v1).not.toBe(v2);
  });

  it("keys never contain raw workspace ids or emails", () => {
    const { service } = makeService();
    const workspaceId = "11111111-2222-3333-4444-555555555555";
    const key = service.keyFor("projects", "list", {
      workspaceId,
      authzEpoch: 1,
      parameters: { email: "person@example.com" },
    });
    expect(key).not.toContain(workspaceId);
    expect(key).not.toContain("person@example.com");
  });
});

describe("in-memory store", () => {
  it("set/get/delete with TTL expiry", async () => {
    const store = new InMemoryCacheStore();
    await store.set("k", "v", 10_000);
    expect(await store.get("k")).toBe("v");
    await store.set("short", "v", -1); // already expired
    expect(await store.get("short")).toBeNull();
    await store.delete("k");
    expect(await store.get("k")).toBeNull();
  });
});

describe("cache-aside with single-flight (§12.5)", () => {
  it("second caller hits; load runs once (§12.11 test 1)", async () => {
    const { service } = makeService();
    const input = { workspaceId: "ws-1", authzEpoch: 1 };
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { data: "value" };
    };
    const first = await service.through("projects", "list", input, 60_000, load);
    const second = await service.through("projects", "list", input, 60_000, load);
    expect(first).toEqual({ data: "value" });
    expect(second).toEqual({ data: "value" });
    expect(loads).toBe(1);
    expect(service.snapshotStats()["projects:list"]).toMatchObject({ hits: 1, misses: 1 });
  });

  it("different tenants miss each other (§12.11 test 1)", async () => {
    const { service } = makeService();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return "v";
    };
    await service.through("projects", "list", { workspaceId: "ws-a" }, 60_000, load);
    await service.through("projects", "list", { workspaceId: "ws-b" }, 60_000, load);
    expect(loads).toBe(2);
  });

  it("concurrent misses join one single-flight leader (§12.5)", async () => {
    const { service } = makeService();
    let loads = 0;
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "v";
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.through("graph", "search", { workspaceId: "ws-1" }, 60_000, load)),
    );
    expect(results.every((r) => r === "v")).toBe(true);
    expect(loads).toBe(1);
    expect(service.snapshotStats()["graph:search"]?.joins).toBe(7);
  });

  it("negative results are cached (revoked share stays cheap)", async () => {
    const { service } = makeService();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return null;
    };
    const first = await service.through("share", "view", { keyMaterial: "dead-token" }, 60_000, load);
    const second = await service.through("share", "view", { keyMaterial: "dead-token" }, 60_000, load);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(loads).toBe(1);
  });

  it("invalidate + seedNegative make the value inaccessible (§12.11 test 10)", async () => {
    const { service, store } = makeService();
    const input = { workspaceId: "ws-1", parameters: { report_id: "r1" } };
    await service.through("reports", "detail", input, 60_000, async () => "secret");
    await service.invalidate("reports", "detail", input);
    expect(await store.get(service.keyFor("reports", "detail", input))).toBeNull();
    await service.seedNegative("reports", "detail", input, 60_000);
    const value = await service.through("reports", "detail", input, 60_000, async () => "recomputed");
    expect(value).toBeNull();
  });

  it("store failure bypasses to the source of truth (§12.11 test 7)", async () => {
    const failing: CacheStore = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
      delete: async () => {
        throw new Error("redis down");
      },
    };
    const { service } = makeService(failing);
    const value = await service.through("projects", "list", { workspaceId: "ws-1" }, 60_000, async () => "from-db");
    expect(value).toBe("from-db");
    expect(service.snapshotStats()["projects:list"]?.bypasses).toBeGreaterThanOrEqual(1);
  });
});

describe("generations", () => {
  let service: CacheService;
  let versions: Map<string, number>;

  beforeEach(() => {
    versions = new Map();
    const pool = {
      query: async (_sql: string, params: unknown[]) => {
        const key = `${params[0]}:${params[1]}`;
        return { rows: [{ version: versions.get(key) ?? 0 }] };
      },
    } as unknown as pg.Pool;
    service = new CacheService(pool, new InMemoryCacheStore());
  });

  it("reads version 0 for unknown scopes and memoises lookups", async () => {
    expect(await service.generation("ws-1", "projects")).toBe(0);
    versions.set("ws-1:projects", 9);
    // Memoised: still 0 within the memo window.
    expect(await service.generation("ws-1", "projects")).toBe(0);
    // Fresh read after memo expiry.
    expect(await service.generation("ws-1", "projects", -1)).toBe(9);
  });

  it("bumpGeneration upserts and refreshes the memo", async () => {
    const client = {
      query: async (_sql: string, params: unknown[]) => {
        const key = `${params[0]}:${params[1]}`;
        const next = (versions.get(key) ?? 0) + 1;
        versions.set(key, next);
        return { rows: [{ version: next }] };
      },
    } as unknown as pg.PoolClient;
    expect(await service.bumpGeneration(client, "ws-1", "reports")).toBe(1);
    expect(await service.bumpGeneration(client, "ws-1", "reports")).toBe(2);
    expect(await service.generation("ws-1", "reports")).toBe(2);
  });
});
