import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "./pg.module.js";

export interface TenantContext {
  workspaceId: string;
  userId?: string;
}

/**
 * Transaction helper: every transaction sets the RLS context
 * (SET LOCAL app.workspace_id / app.user_id) so policies scope rows to the
 * verified tenant. Never trust client-supplied workspace ids (§3.1): callers
 * must pass a workspaceId that was itself verified via membership lookup.
 */
@Injectable()
export class Tx {
  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  async run<T>(ctx: TenantContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [ctx.workspaceId]);
      if (ctx.userId) {
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctx.userId]);
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Unscoped (non-tenant) operations: login, membership resolution, webhooks. */
  async runSystem<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
