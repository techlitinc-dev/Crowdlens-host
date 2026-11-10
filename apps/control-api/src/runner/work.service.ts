import { Inject, Injectable, Logger } from "@nestjs/common";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PG_APP_POOL } from "../db/pg.module.js";

export type WorkKind = "document.parse" | "graph.build" | "simulation.stage" | "report.generate";

export interface WorkItem {
  id: number;
  workspace_id: string;
  kind: WorkKind;
  ref_id: string;
  payload: Record<string, unknown>;
  status: "queued" | "leased" | "done" | "failed" | "cancelled";
  attempt: number;
  max_attempts: number;
  lease_owner: string | null;
}

/**
 * Durable work queue backed by PostgreSQL. Workers claim items with
 * FOR UPDATE SKIP LOCKED leases, heartbeat while running, and complete or
 * fail with bounded retries. This is the local execution substrate that
 * mirrors coarse Temporal activities (architecture.md §8.1).
 */
@Injectable()
export class WorkService {
  private readonly logger = new Logger("work");

  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  /** Enqueue idempotently per (kind, ref_id, dedupe key). */
  async enqueue(input: {
    workspaceId: string;
    kind: WorkKind;
    refId: string;
    payload: Record<string, unknown>;
    dedupeKey?: string;
  }): Promise<{ id: number; alreadyQueued: boolean }> {
    const key = input.dedupeKey ?? `${input.kind}:${input.refId}`;
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO work_items (workspace_id, kind, ref_id, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.workspaceId, input.kind, input.refId, JSON.stringify({ ...input.payload, dedupe_key: key })],
    );
    if (rows[0]) return { id: rows[0].id, alreadyQueued: false };
    const existing = await this.pool.query<{ id: number }>(
      `SELECT id FROM work_items
       WHERE workspace_id = $1 AND kind = $2 AND ref_id = $3
         AND payload->>'dedupe_key' = $4 AND status IN ('queued','leased')
       ORDER BY id LIMIT 1`,
      [input.workspaceId, input.kind, input.refId, key],
    );
    return { id: existing.rows[0]?.id ?? 0, alreadyQueued: true };
  }

  /** Claim the next queued item. Returns null when nothing is available. */
  async claim(owner: string, kinds: WorkKind[], leaseSeconds = 120): Promise<WorkItem | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<WorkItem>(
        `UPDATE work_items
         SET status = 'leased', lease_owner = $1, lease_expires = now() + ($2 || ' seconds')::interval,
             attempt = attempt + 1, heartbeat_at = now(), updated_at = now()
         WHERE id = (
           SELECT id FROM work_items
           WHERE (status = 'queued' OR (status = 'leased' AND lease_expires < now()))
             AND kind = ANY($3)
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [owner, String(leaseSeconds), kinds],
      );
      await client.query("COMMIT");
      return rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(itemId: number, owner: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE work_items SET heartbeat_at = now(), updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND status = 'leased'`,
      [itemId, owner],
    );
    return result.rowCount === 1;
  }

  async complete(itemId: number, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE work_items SET status = 'done', lease_owner = NULL, updated_at = now()
       WHERE id = $1 AND lease_owner = $2`,
      [itemId, owner],
    );
  }

  async fail(itemId: number, owner: string, error: string): Promise<WorkItem | null> {
    const { rows } = await this.pool.query<WorkItem>(
      `UPDATE work_items
       SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
           lease_owner = NULL, last_error = $3, updated_at = now()
       WHERE id = $1 AND lease_owner = $2
       RETURNING *`,
      [itemId, owner, error.slice(0, 2000)],
    );
    const item = rows[0];
    if (item && item.status === "failed") {
      this.logger.error(`work item ${itemId} exhausted attempts: ${error.slice(0, 200)}`);
    }
    return item ?? null;
  }

  async cancelForSimulation(workspaceId: string, simulationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE work_items SET status = 'cancelled', updated_at = now()
       WHERE workspace_id = $1 AND kind IN ('simulation.stage','report.generate')
         AND ref_id = $2 AND status IN ('queued','leased')`,
      [workspaceId, simulationId],
    );
  }

  static ownerId(name: string): string {
    return `${name}-${randomUUID().slice(0, 8)}`;
  }
}
