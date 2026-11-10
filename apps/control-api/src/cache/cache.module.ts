import { Global, Inject, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { CacheService } from "./cache.service.js";
import { CACHE_STORE, InMemoryCacheStore, RedisCacheStore, type CacheStore } from "./cache-store.js";

/**
 * Cache wiring: Redis when REDIS_URL is configured, bounded in-memory store
 * otherwise (single-process local default). Store selection is logged at boot
 * as part of the §6 configuration summary.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      inject: [CONFIG_TOKEN],
      useFactory: async (config: AppConfig): Promise<CacheStore> => {
        const logger = new Logger("cache");
        if (config.REDIS_URL) {
          try {
            return await RedisCacheStore.connect(config.REDIS_URL);
          } catch (error) {
            logger.warn(
              `REDIS_URL configured but Redis unreachable (${(error as Error).message}); ` +
                "falling back to the bounded in-memory store (§12.10)",
            );
          }
        }
        return new InMemoryCacheStore();
      },
    },
    CacheService,
  ],
  exports: [CACHE_STORE, CacheService],
})
export class CacheModule implements OnApplicationShutdown {
  private readonly logger = new Logger("cache");
  constructor(@Inject(CACHE_STORE) private readonly store: CacheStore) {}

  async onApplicationShutdown(): Promise<void> {
    const maybeRedis = this.store as { disconnect?: () => Promise<void> };
    if (typeof maybeRedis.disconnect === "function") {
      await maybeRedis.disconnect().catch((error: Error) => {
        this.logger.warn(`redis disconnect failed: ${error.message}`);
      });
    }
  }
}
