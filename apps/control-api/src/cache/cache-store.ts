/**
 * Cache store adapters (architecture.md §12.1 "Redis" layer).
 *
 * The store interface is deliberately string-in/string-out: versioned keys and
 * JSON serialisation live in CacheService, so adapters stay trivial and
 * replaceable. Failure behaviour (§12.10): store errors are contained by
 * CacheService, which falls back to the source of truth — a cache outage must
 * never corrupt state or expose data.
 */

export interface CacheStore {
  /** Raw serialised value, or null when absent/expired. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Injection token for the configured store (see cache.module.ts). */
export const CACHE_STORE = "CACHE_STORE";

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

const MAX_ENTRIES = 10_000;

/** Process-local store. Default without REDIS_URL; also the bounded fallback. */
export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      // Bound memory: drop the oldest insertion (Map preserves order).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

/**
 * Redis-backed store (ioredis, loaded lazily so the local default stays
 * dependency-light). Connections are best-effort: CacheService treats errors
 * as cache misses and keeps serving from the database (§12.10).
 */
export class RedisCacheStore implements CacheStore {
  private constructor(
    private readonly client: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
      del(...keys: string[]): Promise<unknown>;
      quit(): Promise<void>;
    },
  ) {}

  static async connect(url: string): Promise<RedisCacheStore> {
    const { default: Redis } = (await import("ioredis")) as unknown as {
      default: new (url: string, opts: { lazyConnect?: boolean; maxRetriesPerRequest?: number }) => {
        connect(): Promise<void>;
        get(key: string): Promise<string | null>;
        set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
        del(...keys: string[]): Promise<unknown>;
        quit(): Promise<void>;
      };
    };
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    return new RedisCacheStore(client);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, "PX", ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
