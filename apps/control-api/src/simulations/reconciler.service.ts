import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import pg from "pg";
import { PG_POOL } from "../db/pg.module.js";
import { LedgerService } from "../billing/ledger.service.js";
import { RATE_CARD, settleCreditsFor } from "../billing/catalog.js";

/**
 * Control-plane reconciler (runs inside the API process locally; a separate
 * deployment unit in production). Responsibilities, each idempotent:
 *  1. Settle runs whose workers reported 'finalizing' (usage → ledger).
 *  2. Finalize runs that are 'running' with all shards complete.
 *  3. Fail stalled leases/heartbeats and release their reservations honestly.
 *  4. Honour cancellation between units of work.
 *  5. Publish outbox events (mark published) — no business effect lost.
 *
 * Uses the OWNER pool deliberately: it operates across tenants on rows it
 * selects itself (never user-supplied ids), and RLS would hide cross-tenant
 * recovery scans. Billing authority stays in the control plane.
 */
@Injectable()
export class ReconcilerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("reconciler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick().catch((error) => {
      this.logger.error(`tick failed: ${(error as Error).message}`);
    }), 4000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.settleFinalizing();
      await this.completeShards();
      await this.failStalled();
      await this.honourCancellation();
      await this.publishOutbox();
    } finally {
      this.running = false;
    }
  }

  private async settleFinalizing(): Promise<void> {
    const { rows } = await this.pool.query<{ workspace_id: string; id: string }>(
      `SELECT workspace_id, id FROM simulations
       WHERE status = 'finalizing'
         AND cancel_requested_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM simulation_shards s
           WHERE s.workspace_id = simulations.workspace_id AND s.simulation_id = simulations.id
             AND s.status <> 'done'
         )
       LIMIT 10`,
    );
    for (const row of rows) {
      const usage = await this.ledger.usageForSimulation(row.id);
      const credits = settleCreditsFor(RATE_CARD, usage);
      await this.ledger.settle({
        workspaceId: row.workspace_id,
        simulationId: row.id,
        usageAmount: credits,
        rateCardVersion: RATE_CARD.version,
        actor: "reconciler",
      });
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [row.workspace_id]);
        await client.query(
          `UPDATE simulations SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE workspace_id = $1 AND id = $2 AND status = 'finalizing'`,
          [row.workspace_id, row.id],
        );
        await client.query(
          `INSERT INTO simulation_events (workspace_id, simulation_id, type, payload, authz_epoch)
           VALUES ($1, $2, 'run_completed', $3, 1)`,
          [row.workspace_id, row.id, JSON.stringify({ credits_settled: credits })],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    }
  }

  private async completeShards(): Promise<void> {
    // Shards finished but the run was never moved to finalizing (worker crash
    // between shard completion and transition) — recovery without double work.
    await this.pool.query(
      `UPDATE simulations SET status = 'finalizing', updated_at = now()
       WHERE status = 'running'
         AND cancel_requested_at IS NULL
         AND EXISTS (SELECT 1 FROM simulation_shards s WHERE s.simulation_id = simulations.id)
         AND NOT EXISTS (
           SELECT 1 FROM simulation_shards s
           WHERE s.workspace_id = simulations.workspace_id AND s.simulation_id = simulations.id
             AND s.status <> 'done'
         )
         AND updated_at < now() - interval '10 seconds'`,
    );
  }

  private async failStalled(): Promise<void> {
    const { rows } = await this.pool.query<{ workspace_id: string; id: string; status: string }>(
      `SELECT workspace_id, id, status FROM simulations
       WHERE status IN ('queued','preparing','running','paused')
         AND updated_at < now() - interval '10 minutes'
         AND (SELECT COUNT(*) FROM work_items w
              WHERE w.ref_id = simulations.id AND w.status IN ('queued','leased')) = 0
       LIMIT 10`,
    );
    for (const row of rows) {
      this.logger.warn(`failing stalled simulation ${row.id} (status ${row.status})`);
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [row.workspace_id]);
        await client.query(
          `UPDATE simulations SET status = 'failed', error = 'stalled: no worker progress', completed_at = now(), updated_at = now()
           WHERE workspace_id = $1 AND id = $2`,
          [row.workspace_id, row.id],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      // Consume actual durable work, release the rest.
      const usage = await this.ledger.usageForSimulation(row.id);
      const credits = settleCreditsFor(RATE_CARD, usage);
      await this.ledger.settle({
        workspaceId: row.workspace_id,
        simulationId: row.id,
        usageAmount: credits,
        rateCardVersion: RATE_CARD.version,
        actor: "reconciler",
      });
    }
  }

  private async honourCancellation(): Promise<void> {
    const { rows } = await this.pool.query<{ workspace_id: string; id: string; status: string }>(
      `SELECT workspace_id, id, status FROM simulations
       WHERE cancel_requested_at IS NOT NULL AND status IN ('preparing','running','paused')
       LIMIT 10`,
    );
    for (const row of rows) {
      this.logger.log(`finalizing cancellation for ${row.id}`);
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [row.workspace_id]);
        await client.query(
          `UPDATE simulations SET status = 'cancelled', completed_at = now(), updated_at = now()
           WHERE workspace_id = $1 AND id = $2`,
          [row.workspace_id, row.id],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const usage = await this.ledger.usageForSimulation(row.id);
      const credits = settleCreditsFor(RATE_CARD, usage);
      await this.ledger.settle({
        workspaceId: row.workspace_id,
        simulationId: row.id,
        usageAmount: credits,
        rateCardVersion: RATE_CARD.version,
        actor: "reconciler",
      });
    }
  }

  private async publishOutbox(): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events SET published_at = now() WHERE published_at IS NULL AND id IN (
         SELECT id FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 200
       )`,
    );
  }
}
