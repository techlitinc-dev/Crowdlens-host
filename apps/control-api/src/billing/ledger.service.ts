import { Inject, Injectable, Logger } from "@nestjs/common";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { LedgerEntryType } from "@crowdlens/contracts";
import { PG_APP_POOL, PG_POOL } from "../db/pg.module.js";
import { problems } from "../common/problem-details.js";

/**
 * Immutable integer-credit ledger (specs.md §9.3, architecture.md §11.2).
 *
 * Invariants enforced in database transactions:
 *  - Wallet balance is DERIVED from ledger entries (available cache is a
 *    projection, never the authority).
 *  - Reservation is atomic: locks the wallet row, re-reads active holds,
 *    inserts reservation + ledger entry, enforces non-negative availability.
 *  - Settlement is idempotent per run: exactly one settlement transaction
 *    flips the reservation; usage debits key on durable usage records.
 *  - Unique idempotency keys make retries exactly-once.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger("ledger");

  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(PG_POOL) private readonly ownerPool: pg.Pool,
  ) {}

  private async ensureWallet(client: pg.PoolClient, workspaceId: string): Promise<void> {
    await client.query(`INSERT INTO wallets (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
      workspaceId,
    ]);
  }

  /** Derived balance straight from the ledger (authoritative read). */
  async balanceFromLedger(client: pg.PoolClient, workspaceId: string): Promise<{
    granted: number;
    debited: number;
    reserved: number;
    available: number;
  }> {
    const { rows } = await client.query<{
      granted: number;
      debited: number;
      reserved: number;
    }>(
      `WITH grants AS (
         SELECT COALESCE(SUM(amount), 0)::int AS total FROM credit_ledger_entries
         WHERE workspace_id = $1 AND entry_type IN ('plan_grant','topup_grant','reservation_release')
            OR (workspace_id = $1 AND entry_type = 'adjustment' AND amount > 0)
       ),
       debits AS (
         SELECT COALESCE(SUM(amount), 0)::int AS total FROM credit_ledger_entries
         WHERE workspace_id = $1 AND (entry_type IN ('usage_debit','expiration')
            OR (entry_type = 'adjustment' AND amount < 0))
       ),
       holds AS (
         SELECT COALESCE(SUM(amount), 0)::int AS total FROM credit_reservations
         WHERE workspace_id = $1 AND status = 'active'
       )
       SELECT grants.total AS granted, debits.total AS debited, holds.total AS reserved
       FROM grants, debits, holds`,
      [workspaceId],
    );
    const granted = rows[0]?.granted ?? 0;
    const debited = rows[0]?.debited ?? 0;
    const reserved = rows[0]?.reserved ?? 0;
    return { granted, debited, reserved, available: granted - debited - reserved };
  }

  private async postEntry(
    client: pg.PoolClient,
    entry: {
      workspaceId: string;
      type: LedgerEntryType;
      amount: number;
      idempotencyKey: string;
      rateCardVersion: string;
      actor?: string;
      eventRef?: string;
      simulationId?: string;
      reason?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO credit_ledger_entries
         (workspace_id, entry_type, amount, idempotency_key, rate_card_version, actor, event_ref, simulation_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [
        entry.workspaceId,
        entry.type,
        entry.amount,
        entry.idempotencyKey,
        entry.rateCardVersion,
        entry.actor ?? "system",
        entry.eventRef ?? "",
        entry.simulationId ?? null,
        entry.reason ?? "",
      ],
    );
  }

  /** Grants credits (plan or top-up). Idempotent by event reference. */
  async grant(input: {
    workspaceId: string;
    type: "plan_grant" | "topup_grant";
    amount: number;
    rateCardVersion: string;
    actor: string;
    eventRef: string;
    reason?: string;
  }): Promise<{ granted: boolean; balance: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);
      await this.ensureWallet(client, input.workspaceId);
      await this.postEntry(client, {
        workspaceId: input.workspaceId,
        type: input.type,
        amount: input.amount,
        idempotencyKey: `grant:${input.eventRef}`,
        rateCardVersion: input.rateCardVersion,
        actor: input.actor,
        eventRef: input.eventRef,
        reason: input.reason ?? "",
      });
      const balance = await this.balanceFromLedger(client, input.workspaceId);
      await client.query(
        `UPDATE wallets SET available = $2, version = version + 1, updated_at = now() WHERE workspace_id = $1`,
        [input.workspaceId, balance.available],
      );
      await client.query("COMMIT");
      return { granted: true, balance: balance.available };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically reserves credits for a run. The safety margin is included in
   * `amount` by the caller (estimate high bound). Concurrent runs cannot
   * overdraw: the wallet row is locked and availability is re-read in-transaction.
   */
  async reserve(input: {
    workspaceId: string;
    simulationId: string;
    amount: number;
    rateCardVersion: string;
    actor: string;
  }): Promise<{ reservationId: string; availableAfter: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);
      await this.ensureWallet(client, input.workspaceId);
      // Lock the wallet row for the duration of the reservation decision.
      await client.query(`SELECT 1 FROM wallets WHERE workspace_id = $1 FOR UPDATE`, [
        input.workspaceId,
      ]);
      const balance = await this.balanceFromLedger(client, input.workspaceId);
      if (balance.available < input.amount) {
        await client.query("ROLLBACK");
        throw problems.insufficientCredits(
          `This run needs ${input.amount} credits but only ${balance.available} are available (granted ${balance.granted}, debited ${balance.debited}, reserved ${balance.reserved}). Buy a credit pack or lower the hard cap.`,
          { available: balance.available, required: input.amount },
        );
      }
      const reservationId = randomUUID();
      await client.query(
        `INSERT INTO credit_reservations (workspace_id, id, simulation_id, amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (simulation_id) DO NOTHING`,
        [input.workspaceId, reservationId, input.simulationId, input.amount],
      );
      await this.postEntry(client, {
        workspaceId: input.workspaceId,
        type: "reservation",
        amount: input.amount,
        idempotencyKey: `reserve:${input.simulationId}`,
        rateCardVersion: input.rateCardVersion,
        actor: input.actor,
        simulationId: input.simulationId,
      });
      const after = await this.balanceFromLedger(client, input.workspaceId);
      await client.query(
        `UPDATE wallets SET available = $2, reserved = $3, version = version + 1, updated_at = now()
         WHERE workspace_id = $1`,
        [input.workspaceId, after.available, after.reserved],
      );
      await client.query("COMMIT");
      return { reservationId, availableAfter: after.available };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Idempotent settlement: debits actual usage once and releases the unused
   * reservation remainder. Safe to call concurrently and on retry — the
   * reservation status guard makes exactly one settlement effective.
   */
  async settle(input: {
    workspaceId: string;
    simulationId: string;
    usageAmount: number;
    rateCardVersion: string;
    actor: string;
  }): Promise<{ settled: boolean; debited: number; released: number; balance: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);
      const { rows } = await client.query<{ id: string; amount: number }>(
        `UPDATE credit_reservations SET status = 'settled', updated_at = now()
         WHERE workspace_id = $1 AND simulation_id = $2 AND status = 'active'
         RETURNING id, amount`,
        [input.workspaceId, input.simulationId],
      );
      if (!rows[0]) {
        await client.query("COMMIT");
        const balance = await this.balanceFromLedger(client, input.workspaceId);
        return { settled: false, debited: 0, released: 0, balance: balance.available };
      }
      const reservedAmount = rows[0].amount;
      const usage = Math.max(0, Math.min(input.usageAmount, reservedAmount));
      const released = reservedAmount - usage;
      if (usage > 0) {
        await this.postEntry(client, {
          workspaceId: input.workspaceId,
          type: "usage_debit",
          amount: usage,
          idempotencyKey: `settle-debit:${input.simulationId}`,
          rateCardVersion: input.rateCardVersion,
          actor: input.actor,
          simulationId: input.simulationId,
          reason: "actual usage settlement",
        });
      }
      if (released > 0) {
        await this.postEntry(client, {
          workspaceId: input.workspaceId,
          type: "reservation_release",
          amount: released,
          idempotencyKey: `settle-release:${input.simulationId}`,
          rateCardVersion: input.rateCardVersion,
          actor: input.actor,
          simulationId: input.simulationId,
          reason: "unused reservation released",
        });
      }
      await client.query(
        `UPDATE simulations SET credits_used = $3
         WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.simulationId, usage],
      );
      const balance = await this.balanceFromLedger(client, input.workspaceId);
      await client.query(
        `UPDATE wallets SET available = $2, reserved = $3, version = version + 1, updated_at = now()
         WHERE workspace_id = $1`,
        [input.workspaceId, balance.available, balance.reserved],
      );
      await client.query("COMMIT");
      return { settled: true, debited: usage, released, balance: balance.available };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Releases an active reservation without usage (cancellation). Idempotent. */
  async release(input: {
    workspaceId: string;
    simulationId: string;
    rateCardVersion: string;
    actor: string;
    consumedCredits?: number;
  }): Promise<{ released: number }> {
    const consumed = Math.max(0, input.consumedCredits ?? 0);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);
      const { rows } = await client.query<{ amount: number }>(
        `UPDATE credit_reservations SET status = 'released', updated_at = now()
         WHERE workspace_id = $1 AND simulation_id = $2 AND status = 'active'
         RETURNING amount`,
        [input.workspaceId, input.simulationId],
      );
      let released = 0;
      if (rows[0]) {
        const amount = rows[0].amount;
        released = Math.max(0, amount - consumed);
        if (consumed > 0) {
          await this.postEntry(client, {
            workspaceId: input.workspaceId,
            type: "usage_debit",
            amount: consumed,
            idempotencyKey: `release-debit:${input.simulationId}`,
            rateCardVersion: input.rateCardVersion,
            actor: input.actor,
            simulationId: input.simulationId,
            reason: "consumed work billed on cancellation",
          });
        }
        if (released > 0) {
          await this.postEntry(client, {
            workspaceId: input.workspaceId,
            type: "reservation_release",
            amount: released,
            idempotencyKey: `release:${input.simulationId}`,
            rateCardVersion: input.rateCardVersion,
            actor: input.actor,
            simulationId: input.simulationId,
            reason: "reservation released on cancellation",
          });
        }
      }
      const balance = await this.balanceFromLedger(client, input.workspaceId);
      await client.query(
        `UPDATE wallets SET available = $2, reserved = $3, version = version + 1, updated_at = now()
         WHERE workspace_id = $1`,
        [input.workspaceId, balance.available, balance.reserved],
      );
      await client.query("COMMIT");
      return { released };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Durable usage records for a run (settlement input, rated by the caller). */
  async usageForSimulation(simulationId: string): Promise<{
    usage_type: string;
    units: number;
    provider: string;
  }[]> {
    // Owner pool: settlement is control-plane authority; rows are selected by
    // the run id the reconciler itself discovered (never user-supplied).
    const { rows } = await this.ownerPool.query<{
      usage_type: string;
      units: number;
      provider: string;
    }>(
      `SELECT usage_type,
              CASE usage_type
                WHEN 'active_reasoning' THEN COUNT(*)::int
                WHEN 'population_tick' THEN COALESCE(SUM(input_tokens), 0)::int
                WHEN 'graph_chunk' THEN COUNT(*)::int
                ELSE COUNT(*)::int
              END AS units,
              MAX(provider) AS provider
       FROM usage_records
       WHERE simulation_id = $1
       GROUP BY usage_type`,
      [simulationId],
    );
    return rows;
  }
}
