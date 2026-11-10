import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { Role } from "@crowdlens/contracts";
import { PG_APP_POOL } from "../db/pg.module.js";
import { AuditService, OutboxService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_code: string;
  authz_epoch: number;
  created_at: Date;
}

export interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: Role;
  email: string;
  display_name: string;
  created_at: Date;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Creates a workspace; caller becomes owner. Runs in a tx scoped to the new tenant id. */
  async create(userId: string, input: { name: string; slug?: string }): Promise<WorkspaceRow> {
    const id = randomUUID();
    const slug = `${slugify(input.slug ?? input.name)}-${id.slice(0, 8)}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Scope the transaction to the NEW tenant so RLS WITH CHECK passes.
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [id]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const { rows } = await client.query<WorkspaceRow>(
        `INSERT INTO workspaces (id, slug, name)
         VALUES ($1, $2, $3)
         RETURNING id, slug, name, status, plan_code, authz_epoch, created_at`,
        [id, slug, input.name],
      );
      await client.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, userId],
      );
      await client.query(`INSERT INTO wallets (workspace_id) VALUES ($1)`, [id]);
      // Free-tier entitlement: Explorer includes 300 one-time credits. Paid
      // plan grants arrive only via verified Razorpay webhooks; this free
      // grant is keyed to the workspace creation event (idempotent).
      await client.query(
        `INSERT INTO credit_ledger_entries
           (workspace_id, entry_type, amount, idempotency_key, rate_card_version, actor, event_ref, reason)
         VALUES ($1, 'plan_grant', 300, $2, 'credits-2026-11-09', 'system', $3, 'Explorer plan one-time included credits')
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
        [id, `grant:workspace-created:${id}`, `workspace-created:${id}`],
      );
      await this.audit.record(client, {
        workspaceId: id,
        actor: userId,
        action: "workspace.created",
        targetType: "workspace",
        targetId: id,
      });
      await this.outbox.emit(client, {
        eventType: "workspace.created",
        workspaceId: id,
        aggregateId: id,
        payload: { name: input.name, slug },
      });
      await client.query("COMMIT");
      return rows[0]!;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listForUser(userId: string): Promise<WorkspaceRow[]> {
    const { rows } = await this.pool.query<WorkspaceRow>(
      `SELECT w.id, w.slug, w.name, w.status, w.plan_code, w.authz_epoch, w.created_at
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = $1 AND w.status = 'active'
       ORDER BY w.created_at`,
      [userId],
    );
    return rows;
  }

  async members(workspaceId: string): Promise<MemberRow[]> {
    const { rows } = await this.pool.query<MemberRow>(
      `SELECT m.workspace_id, m.user_id, m.role, u.email, u.display_name, m.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
       ORDER BY m.created_at`,
      [workspaceId],
    );
    return rows;
  }

  /**
   * Adds or updates a membership. Bumps authz_epoch so SSE channels, cached
   * entries, and running authorisation checks observe the change immediately.
   */
  async upsertMember(params: {
    workspaceId: string;
    actorId: string;
    userId: string;
    role: Role;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [params.workspaceId]);
      await client.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
        [params.workspaceId, params.userId, params.role],
      );
      await this.bumpAuthzEpoch(client, params.workspaceId);
      await this.audit.record(client, {
        workspaceId: params.workspaceId,
        actor: params.actorId,
        action: "membership.upserted",
        targetType: "user",
        targetId: params.userId,
        metadata: { role: params.role },
      });
      await this.outbox.emit(client, {
        eventType: "membership.changed",
        workspaceId: params.workspaceId,
        aggregateId: params.userId,
        payload: { role: params.role },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(params: {
    workspaceId: string;
    actorId: string;
    userId: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [params.workspaceId]);
      const { rows: owners } = await client.query(
        `SELECT COUNT(*)::int AS count FROM memberships
         WHERE workspace_id = $1 AND role = 'owner' AND user_id <> $2`,
        [params.workspaceId, params.userId],
      );
      const target = await client.query<{ role: Role }>(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [params.workspaceId, params.userId],
      );
      if (target.rows[0]?.role === "owner" && owners[0]!.count === 0) {
        throw problems.conflict("Cannot remove the last owner of a workspace");
      }
      const result = await client.query(
        `DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
        [params.workspaceId, params.userId],
      );
      if (result.rowCount === 0) throw problems.notFound("membership");
      await this.bumpAuthzEpoch(client, params.workspaceId);
      await client.query(
        `UPDATE report_shares SET revoked_at = now()
         WHERE workspace_id = $1 AND created_by = $2 AND revoked_at IS NULL`,
        [params.workspaceId, params.userId],
      );
      await this.audit.record(client, {
        workspaceId: params.workspaceId,
        actor: params.actorId,
        action: "membership.removed",
        targetType: "user",
        targetId: params.userId,
      });
      await this.outbox.emit(client, {
        eventType: "membership.revoked",
        workspaceId: params.workspaceId,
        aggregateId: params.userId,
        payload: {},
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async bumpAuthzEpoch(client: pg.PoolClient, workspaceId: string): Promise<void> {
    await client.query(
      `UPDATE workspaces SET authz_epoch = authz_epoch + 1 WHERE id = $1`,
      [workspaceId],
    );
  }
}
