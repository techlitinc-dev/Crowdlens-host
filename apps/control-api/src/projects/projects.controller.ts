import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import pg from "pg";
import { z } from "zod";
import { PG_APP_POOL } from "../db/pg.module.js";
import { AuditService, OutboxService } from "../audit/audit.service.js";
import { IdempotencyService } from "../common/idempotency.js";
import { problems } from "../common/problem-details.js";
import { buildPage, cursorQuerySchema } from "../common/pagination.js";
import { CanRead, CanWriteProject, Req } from "../auth/rbac.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { planByCode } from "../billing/catalog.js";
import { Tx } from "../db/tx.js";
import { CacheService, CACHE_TTLS } from "../cache/cache.service.js";

const createSchema = z.object({
  name: z.string().min(2).max(160),
  decision_question: z.string().min(8).max(2000).optional(),
});

const patchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  decision_question: z.string().min(8).max(2000).nullable().optional(),
  stage: z.enum(["evidence", "world", "crowd", "run", "report"]).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

const STAGES = ["evidence", "world", "crowd", "run", "report"] as const;

@Controller("v1/projects")
export class ProjectsController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(Tx) private readonly tx: Tx,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  private async planFor(client: pg.PoolClient, workspaceId: string) {
    const { rows } = await client.query<{ plan_code: string }>(
      `SELECT plan_code FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    return planByCode(rows[0]?.plan_code ?? "explorer") ?? planByCode("explorer")!;
  }

  @Post()
  @CanWriteProject()
  async create(
    @Req() req: TenantRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const input = createSchema.parse(body);
    const key = idempotencyKey ?? `project:${req.auth.userId}:${input.name}`;
    const { value, replayed } = await this.idempotency.run(
      { workspaceId: req.workspaceId, actor: req.auth.userId, route: "POST /v1/projects", key, statusCode: 201 },
      async () =>
        this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
          const plan = await this.planFor(client, req.workspaceId);
          if (plan.maxActiveProjects < 1000) {
            const { rows } = await client.query<{ count: number }>(
              `SELECT COUNT(*)::int AS count FROM projects
               WHERE workspace_id = $1 AND deleted_at IS NULL AND status <> 'archived'`,
              [req.workspaceId],
            );
            if (rows[0]!.count >= plan.maxActiveProjects) {
              throw problems.conflict(
                `Plan ${plan.code} allows ${plan.maxActiveProjects} active project(s). Archive one or upgrade.`,
                { plan: plan.code },
              );
            }
          }
          const { rows } = await client.query(
            `INSERT INTO projects (workspace_id, name, decision_question, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, decision_question, status, stage, version, created_at, updated_at`,
            [req.workspaceId, input.name, input.decision_question ?? "", req.auth.userId],
          );
          const project = rows[0]!;
          await this.audit.record(client, {
            workspaceId: req.workspaceId,
            actor: req.auth.userId,
            action: "project.created",
            targetType: "project",
            targetId: project.id as string,
            requestId: req.requestId,
          });
          await this.outbox.emit(client, {
            eventType: "project.created",
            workspaceId: req.workspaceId,
            aggregateId: project.id as string,
            correlationId: req.requestId,
            payload: { name: input.name },
          });
          await this.cache.bumpGeneration(client, req.workspaceId, "projects");
          return { project };
        }),
    );
    return { ...(value as object), idempotent_replay: replayed };
  }

  @Get()
  @CanRead()
  async list(@Req() req: TenantRequest, @Query() query: Record<string, string>) {
    const { cursor, limit } = cursorQuerySchema.parse(query);
    // §12.3: tenant + user/ACL + filters + cursor + project generation; the
    // authz epoch is always fresh from the guard, so membership revocation
    // never serves a stale list.
    const generation = await this.cache.generation(req.workspaceId, "projects");
    return this.cache.through(
      "projects",
      "list",
      {
        workspaceId: req.workspaceId,
        authzEpoch: req.authzEpoch,
        parameters: { cursor: cursor ?? "", limit, user_id: req.auth.userId },
        generations: { projects: generation },
      },
      CACHE_TTLS.projectList,
      async () =>
        this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
          const cursorClause = cursor ? `AND (updated_at, id) < ($2, $3)` : "";
          const params: unknown[] = cursor
            ? [req.workspaceId, cursor.split("|")[0], cursor.split("|")[1]]
            : [req.workspaceId];
          const { rows } = await client.query(
            `SELECT id, name, decision_question, status, stage, version, created_at, updated_at
             FROM projects
             WHERE workspace_id = $1 AND deleted_at IS NULL ${cursorClause}
             ORDER BY updated_at DESC, id DESC
             LIMIT ${limit + 1}`,
            params as string[],
          );
          return buildPage(rows as Record<string, unknown>[], limit, "updated_at", "id");
        }),
    );
  }

  @Get(":id")
  @CanRead()
  async get(@Req() req: TenantRequest, @Param("id") id: string) {
    const generation = await this.cache.generation(req.workspaceId, "projects");
    return this.cache.through(
      "projects",
      "detail",
      {
        workspaceId: req.workspaceId,
        authzEpoch: req.authzEpoch,
        parameters: { project_id: id, user_id: req.auth.userId },
        generations: { projects: generation },
      },
      CACHE_TTLS.projectDetail,
      async () =>
        this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
          const { rows } = await client.query(
            `SELECT id, name, decision_question, status, stage, version, created_at, updated_at
             FROM projects WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [req.workspaceId, id],
          );
          if (!rows[0]) throw problems.notFound("project");
          const docs = await client.query(
            `SELECT id, filename, mime_type, size_bytes, sha256, parse_status, created_at
             FROM documents WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at`,
            [req.workspaceId, id],
          );
          const graphs = await client.query(
            `SELECT id, embedding_profile, schema_version, status, node_count, edge_count, created_at
             FROM graphs WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
            [req.workspaceId, id],
          );
          const sims = await client.query(
            `SELECT id, status, manifest->>'provider' AS provider, manifest->>'model_id' AS model_id,
                    (config->>'ticks')::int AS ticks, credits_used, created_at
             FROM simulations WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 20`,
            [req.workspaceId, id],
          );
          return {
            project: rows[0],
            documents: docs.rows,
            graphs: graphs.rows,
            simulations: sims.rows,
          };
        }),
    );
  }

  @Patch(":id")
  @CanWriteProject()
  async patch(@Req() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = patchSchema.parse(body);
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [req.workspaceId, id];
      let idx = 3;
      if (input.name !== undefined) {
        sets.push(`name = $${idx++}`);
        params.push(input.name);
      }
      if (input.decision_question !== undefined) {
        sets.push(`decision_question = $${idx++}`);
        params.push(input.decision_question ?? "");
      }
      if (input.stage !== undefined) {
        sets.push(`stage = $${idx++}`);
        params.push(input.stage);
      }
      if (input.status !== undefined) {
        sets.push(`status = $${idx++}`);
        params.push(input.status);
      }
      if (sets.length === 0) throw problems.validation("No fields to update", []);
      const { rows } = await client.query(
        `UPDATE projects SET ${sets.join(", ")}, version = version + 1
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, name, decision_question, status, stage, version, updated_at`,
        params as string[],
      );
      if (!rows[0]) throw problems.notFound("project");
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "project.updated",
        targetType: "project",
        targetId: id,
        requestId: req.requestId,
        metadata: { fields: Object.keys(input) },
      });
      await this.cache.bumpGeneration(client, req.workspaceId, "projects");
      return { project: rows[0] };
    });
  }

  /** Tombstone + asynchronous purge of documents/graphs/artifacts (PRJ-03). */
  @Delete(":id")
  @CanWriteProject()
  async remove(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const { rows } = await client.query(
        `UPDATE projects SET deleted_at = now(), status = 'archived', version = version + 1
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [req.workspaceId, id],
      );
      if (!rows[0]) throw problems.notFound("project");
      await client.query(
        `UPDATE report_shares SET revoked_at = now()
         WHERE workspace_id = $1 AND report_id IN (SELECT id FROM reports WHERE workspace_id = $1 AND simulation_id IN (SELECT id FROM simulations WHERE workspace_id = $1 AND project_id = $2)) AND revoked_at IS NULL`,
        [req.workspaceId, id],
      );
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "project.deleted",
        targetType: "project",
        targetId: id,
        requestId: req.requestId,
        metadata: { purge: "scheduled" },
      });
      await this.outbox.emit(client, {
        eventType: "project.deleted",
        workspaceId: req.workspaceId,
        aggregateId: id,
        correlationId: req.requestId,
        payload: {},
      });
      await this.cache.bumpGeneration(client, req.workspaceId, "projects");
      return { deleted: true, purge: "scheduled" };
    });
  }
}

export { STAGES };
