import {
  Global,
  Inject,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import pg from "pg";
import type EmbeddedPostgresModule from "embedded-postgres";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { migrate } from "./migrate.js";

export const PG_POOL = "PG_POOL";
export const PG_APP_POOL = "PG_APP_POOL";
export const EMBEDDED_PG = "EMBEDDED_PG";

/**
 * Boots PostgreSQL (embedded binaries when configured, else DATABASE_URL),
 * applies migrations as the owner, and exposes:
 *  - PG_POOL: owner pool (migrations)
 *  - PG_APP_POOL: crowdlens_app pool used by all tenant-facing repositories;
 *    every query runs under forced RLS.
 * The embedded instance is stopped on application shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDED_PG,
      inject: [CONFIG_TOKEN],
      useFactory: async (config: AppConfig) => {
        if (!config.EMBEDDED_PG_DATA_DIR) return null;
        const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
          default: typeof EmbeddedPostgresModule;
        };
        const instance = new EmbeddedPostgres({
          databaseDir: config.EMBEDDED_PG_DATA_DIR,
          user: "postgres",
          password: "postgres",
          port: config.EMBEDDED_PG_PORT,
          persistent: true,
        });
        // initialise() always runs initdb; only initialise a fresh cluster.
        const { access } = await import("node:fs/promises");
        const clusterReady = await access(`${config.EMBEDDED_PG_DATA_DIR}/PG_VERSION`).then(
          () => true,
          () => false,
        );
        if (!clusterReady) {
          await instance.initialise();
        }
        await instance.start();
        if (!clusterReady) {
          const client = new pg.Client({
            host: "localhost",
            port: config.EMBEDDED_PG_PORT,
            user: "postgres",
            password: "postgres",
            database: "postgres",
          });
          await client.connect();
          await client.query(`CREATE DATABASE crowdlens`).catch(() => undefined);
          await client.end();
        }
        return instance;
      },
    },
    {
      provide: PG_POOL,
      inject: [CONFIG_TOKEN, EMBEDDED_PG],
      useFactory: async (config: AppConfig, _embedded: unknown) => {
        const connectionString = config.EMBEDDED_PG_DATA_DIR
          ? `postgres://postgres:postgres@localhost:${config.EMBEDDED_PG_PORT}/crowdlens`
          : config.DATABASE_URL;
        const pool = new pg.Pool({ connectionString, max: 5 });
        const client = await pool.connect();
        try {
          const applied = await migrate(client);
          if (applied.length) {
            // eslint-disable-next-line no-console
            console.log(`[db] applied migrations: ${applied.join(", ")}`);
          }
        } finally {
          client.release();
        }
        return pool;
      },
    },
    {
      provide: PG_APP_POOL,
      inject: [CONFIG_TOKEN, PG_POOL],
      useFactory: async (config: AppConfig, _owner: pg.Pool) => {
        if (config.EMBEDDED_PG_DATA_DIR) {
          const pool = new pg.Pool({
            host: "localhost",
            port: config.EMBEDDED_PG_PORT,
            user: "crowdlens_app",
            password: "crowdlens_app_dev",
            database: "crowdlens",
            max: 10,
          });
          return pool;
        }
        // Production: derive the RLS-enforced app role connection. The
        // application role must never bypass RLS (architecture.md §6.2).
        const url = new URL(config.DATABASE_URL);
        if (url.username !== "crowdlens_app") {
          const appPassword = process.env.CROWDLENS_APP_PASSWORD;
          if (!appPassword) {
            throw new Error(
              "CROWDLENS_APP_PASSWORD is required when DATABASE_URL is not the app role",
            );
          }
          url.username = "crowdlens_app";
          url.password = appPassword;
        }
        const pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
        return pool;
      },
    },
  ],
  exports: [PG_POOL, PG_APP_POOL],
})
export class PgModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly ownerPool: pg.Pool,
    @Inject(PG_APP_POOL) private readonly appPool: pg.Pool,
    @Inject(EMBEDDED_PG) private readonly embedded: EmbeddedPostgresModule | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ownerPool.query("SELECT 1");
    await this.appPool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.ownerPool.end(), this.appPool.end()]);
    if (this.embedded) {
      await this.embedded.stop();
    }
  }
}
