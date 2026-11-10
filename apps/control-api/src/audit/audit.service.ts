import { Inject, Injectable, Logger } from "@nestjs/common";
// NOTE: explicit @Inject tokens throughout — the dev/test transpilers do not
// emit decorator metadata, so Nest must never rely on design:paramtypes.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PG_APP_POOL } from "../db/pg.module.js";
import type { EventEnvelope } from "@crowdlens/contracts";

export interface AuditInput {
  workspaceId?: string | null;
  actor: string;
  action: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit (OPS-02) + transactional outbox (architecture.md §7.2).
 * Both write inside the caller's transaction so business effects and their
 * audit/outbox records commit or roll back atomically.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger("audit");

  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  /** Call inside an existing transaction. */
  async record(client: pg.PoolClient, input: AuditInput): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (workspace_id, actor, action, target_type, target_id, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.workspaceId ?? null,
        input.actor,
        input.action,
        input.targetType ?? "",
        input.targetId ?? "",
        input.requestId ?? "",
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  /** Convenience for non-transactional audit (still append-only). */
  async recordStandalone(input: AuditInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_logs (workspace_id, actor, action, target_type, target_id, request_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.workspaceId ?? null,
          input.actor,
          input.action,
          input.targetType ?? "",
          input.targetId ?? "",
          input.requestId ?? "",
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    } catch (error) {
      this.logger.error(`audit write failed: ${(error as Error).message}`);
    }
  }
}

export interface OutboxInput {
  eventType: string;
  workspaceId: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  eventVersion?: number;
}

@Injectable()
export class OutboxService {
  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  /** Call inside an existing transaction. */
  async emit(client: pg.PoolClient, input: OutboxInput): Promise<EventEnvelope> {
    const envelope: EventEnvelope = {
      event_id: randomUUID(),
      event_type: input.eventType,
      event_version: input.eventVersion ?? 1,
      occurred_at: new Date().toISOString(),
      workspace_id: input.workspaceId,
      aggregate_id: input.aggregateId,
      ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
      ...(input.causationId ? { causation_id: input.causationId } : {}),
      payload: input.payload,
    };
    await client.query(
      `INSERT INTO outbox_events
         (event_id, event_type, event_version, occurred_at, workspace_id, aggregate_id, correlation_id, causation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        envelope.event_id,
        envelope.event_type,
        envelope.event_version,
        envelope.occurred_at,
        envelope.workspace_id,
        envelope.aggregate_id,
        envelope.correlation_id ?? null,
        envelope.causation_id ?? null,
        JSON.stringify(envelope.payload),
      ],
    );
    return envelope;
  }
}

export class AuditModuleSymbols {
  static AUDIT = AuditService;
}
