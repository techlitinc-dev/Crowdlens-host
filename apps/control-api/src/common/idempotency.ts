import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "../db/pg.module.js";

export interface IdempotentResult {
  statusCode: number;
  response: unknown;
  replayed: boolean;
}

/**
 * Idempotency-Key support (architecture.md §7.1). The unique
 * (workspace, actor, route, key) constraint makes concurrent retries safe:
 * the first writer wins, later callers receive the recorded response.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  /**
   * Executes `execute` when no record exists. Returns the stored response on
   * replay. `execute` must itself run in a transaction on `client`.
   */
  async run<T>(
    params: {
      workspaceId: string;
      actor: string;
      route: string;
      key: string;
      statusCode: number;
    },
    execute: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const existing = await this.pool.query<{ status_code: number; response: unknown }>(
      `SELECT status_code, response FROM idempotency_keys
       WHERE workspace_id = $1 AND actor = $2 AND route = $3 AND key = $4`,
      [params.workspaceId, params.actor, params.route, params.key],
    );
    const row = existing.rows[0];
    if (row) {
      return { value: row.response as T, replayed: true };
    }
    const value = await execute();
    await this.pool
      .query(
        `INSERT INTO idempotency_keys (workspace_id, actor, route, key, status_code, response)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, actor, route, key) DO NOTHING`,
        [
          params.workspaceId,
          params.actor,
          params.route,
          params.key,
          params.statusCode,
          JSON.stringify(value),
        ],
      )
      .catch((error: Error) => {
        // Unique race: another request recorded first; return its value if readable.
        if (!("constraint" in error && String((error as { constraint?: string }).constraint).includes("idempotency"))) {
          throw error;
        }
      });
    return { value, replayed: false };
  }
}
