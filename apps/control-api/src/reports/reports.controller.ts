import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Response } from "express";
import { PG_APP_POOL, PG_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/storage.service.js";
import { WorkService } from "../runner/work.service.js";
import { AuditService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";
import { CanRead, CanRun, Req as TenantReq } from "../auth/rbac.js";
import { Public } from "../common/public.js";
import { CacheService, CACHE_TTLS } from "../cache/cache.service.js";
import type { TenantRequest } from "../auth/auth-context.js";

const shareSchema = z.object({
  expires_in_hours: z.number().int().min(1).max(24 * 30).default(72),
  scope: z.enum(["summary", "full"]).default("summary"),
});

const interviewSchema = z.object({
  agent_ref: z.string().min(1).max(200),
  question: z.string().min(4).max(2000),
});

/**
 * Reports (immutable versions), revocable expiring shares (RPT-05), exports
 * (RPT-04), and provenance-labelled agent interviews (RPT-06).
 */
@Controller()
export class ReportsController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(PG_POOL) private readonly ownerPool: pg.Pool,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Tx) private readonly tx: Tx,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /** Cache key input for one report's detail (used for read + invalidation). */
  private reportDetailInput(req: TenantRequest, reportId: string, generation: number) {
    return {
      workspaceId: req.workspaceId,
      authzEpoch: req.authzEpoch,
      parameters: { report_id: reportId, user_id: req.auth.userId },
      generations: { reports: generation },
    };
  }

  private async loadReport(client: pg.PoolClient, workspaceId: string, reportId: string) {
    const { rows } = await client.query<{
      id: string;
      simulation_id: string;
      version: number;
      content_hash: string;
      object_key: string;
      evidence_manifest: unknown[];
      status: string;
    }>(
      `SELECT id, simulation_id, version, content_hash, object_key, evidence_manifest, status
       FROM reports WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, reportId],
    );
    if (!rows[0]) throw problems.notFound("report");
    return rows[0];
  }

  @Get("v1/reports/:id")
  @CanRead()
  async get(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    // §12.3: report CONTENT is immutable (24 h TTL); the shares list travels
    // behind the reports generation, bumped in-transaction on share events.
    const generation = await this.cache.generation(req.workspaceId, "reports");
    return this.cache.through(
      "reports",
      "detail",
      this.reportDetailInput(req, id, generation),
      CACHE_TTLS.reportDetail,
      async () =>
        this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
          const report = await this.loadReport(client, req.workspaceId, id);
          const body = await this.storage.get(report.object_key);
          const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
          if (createHash("sha256").update(body).digest("hex") !== report.content_hash) {
            throw problems.internal("Report integrity check failed");
          }
          const { rows: shares } = await client.query(
            `SELECT id, scope, expires_at, revoked_at, created_at FROM report_shares
             WHERE workspace_id = $1 AND report_id = $2 ORDER BY created_at DESC`,
            [req.workspaceId, id],
          );
          return { report: { ...report, content: parsed }, shares };
        }),
    );
  }

  @Post("v1/reports/:id/shares")
  @CanRun()
  async createShare(@TenantReq() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = shareSchema.parse(body);
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const report = await this.loadReport(client, req.workspaceId, id);
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const { rows } = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO report_shares (workspace_id, report_id, token_hash, scope, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6)
         RETURNING id, expires_at`,
        [req.workspaceId, report.id, tokenHash, input.scope, String(input.expires_in_hours), req.auth.userId],
      );
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "report.share.created",
        targetType: "report_share",
        targetId: rows[0]!.id,
        metadata: { scope: input.scope, expires_in_hours: input.expires_in_hours },
      });
      // Bump in-transaction: cached report details keyed at the previous
      // generation stop being readable; the stale entry expires naturally.
      await this.cache.bumpGeneration(client, req.workspaceId, "reports");
      return { share: rows[0], token: `${rows[0]!.id}.${token}` };
    });
  }

  @Delete("v1/report-shares/:id")
  @CanRun()
  async revokeShare(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    const result = await this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const { rows } = await client.query<{ token_hash: string }>(
        `UPDATE report_shares SET revoked_at = now()
         WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
         RETURNING token_hash`,
        [req.workspaceId, id],
      );
      if (!rows[0]) throw problems.notFound("share");
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "report.share.revoked",
        targetType: "report_share",
        targetId: id,
      });
      await this.cache.bumpGeneration(client, req.workspaceId, "reports");
      return rows[0].token_hash;
    });
    // §12.3/§12.6: security-sensitive revocation deletes the exact cached
    // view AND caches the negative result, so a revoked share can never be
    // served a cached 200 (architecture §12 test 5).
    const keyMaterial = `${id}:${result}`;
    await this.cache.invalidate("share", "view", { keyMaterial });
    await this.cache.seedNegative("share", "view", { keyMaterial }, CACHE_TTLS.shareView);
    return { revoked: true };
  }

  /**
   * Public share view (capability token). No-store always; revocation and
   * expiry are enforced here, never by a cached 200 (architecture §12 test 5).
   *
   * The (share id, token hash) pair IS the credential, so the capability
   * lookup runs on the owner pool — the same pattern as session validation —
   * and establishes tenant context for the RLS-enforced report read.
   */
  @Public()
  @Get("v1/report-shares/:token/view")
  @Header("Cache-Control", "private, no-store")
  async viewShare(@Param("token") token: string, @Res() res: Response) {
    const [shareId, rawToken] = token.split(".");
    if (!shareId || !rawToken) throw problems.notFound("share");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const keyMaterial = `${shareId}:${tokenHash}`;
    const projection = await this.cache.through(
      "share",
      "view",
      { keyMaterial },
      CACHE_TTLS.shareView,
      async () => this.loadShareProjection(shareId, tokenHash),
    );
    if (!projection) throw problems.notFound("share");
    res.json(projection);
  }

  /** Loads (and authorises) a share projection; null when revoked/expired/absent. */
  private async loadShareProjection(
    shareId: string,
    tokenHash: string,
  ): Promise<{ report: Record<string, unknown>; scope: string; expires_at: Date | null } | null> {
    const { rows } = await this.ownerPool.query<{
      id: string;
      workspace_id: string;
      report_id: string;
      scope: string;
      expires_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, workspace_id, report_id, scope, expires_at, revoked_at
       FROM report_shares WHERE id = $1 AND token_hash = $2`,
      [shareId, tokenHash],
    );
    const share = rows[0];
    if (!share || share.revoked_at || (share.expires_at && share.expires_at.getTime() < Date.now())) {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [share.workspace_id]);
      const report = await this.loadReport(client, share.workspace_id, share.report_id);
      const body = await this.storage.get(report.object_key);
      const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      if (createHash("sha256").update(body).digest("hex") !== report.content_hash) {
        throw problems.internal("Report integrity check failed");
      }
      await client.query("COMMIT");
      const projection =
        share.scope === "summary"
          ? {
              summary: parsed["summary"],
              segments: parsed["segments"],
              method: parsed["method"],
              limitations: parsed["limitations"],
              disclaimer: parsed["disclaimer"],
            }
          : parsed;
      return { report: projection, scope: share.scope, expires_at: share.expires_at };
    } finally {
      client.release();
    }
  }

  /** Structured export with method/provenance metadata (RPT-04). */
  @Get("v1/reports/:id/export")
  @CanRead()
  async exportReport(
    @TenantReq() req: TenantRequest,
    @Param("id") id: string,
    @Query("format") format: string,
  ) {
    if (!["json", "csv"].includes(format)) throw problems.validation("format must be json or csv", {});
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const report = await this.loadReport(client, req.workspaceId, id);
      const body = await this.storage.get(report.object_key);
      const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "report.exported",
        targetType: "report",
        targetId: id,
        metadata: { format },
      });
      if (format === "json") {
        return {
          filename: `crowdlens-report-${report.version}.json`,
          content_type: "application/json",
          data: {
            meta: {
              report_id: report.id,
              version: report.version,
              content_hash: report.content_hash,
              exported_at: new Date().toISOString(),
            },
            ...parsed,
          },
        };
      }
      const segments = (parsed["segments"] as { name: string; stance: string; share: number }[]) ?? [];
      const rows = ["segment,stance,share,method"];
      for (const segment of segments) {
        rows.push(`"${segment.name}","${segment.stance}",${segment.share},"${report.content_hash.slice(0, 12)}"`);
      }
      return {
        filename: `crowdlens-report-${report.version}-segments.csv`,
        content_type: "text/csv",
        data: rows.join("\n"),
      };
    });
  }

  /** Provenance-labelled agent interview (RPT-06). */
  @Post("v1/reports/:id/interviews")
  @CanRun()
  async interview(@TenantReq() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = interviewSchema.parse(body);
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const report = await this.loadReport(client, req.workspaceId, id);
      const { rows } = await client.query<{ id: string; status: string }>(
        `INSERT INTO interviews (workspace_id, report_id, agent_ref, question)
         VALUES ($1, $2, $3, $4) RETURNING id, status`,
        [req.workspaceId, report.id, input.agent_ref, input.question],
      );
      const interviewId = rows[0]!.id;
      await this.work.enqueue({
        workspaceId: req.workspaceId,
        kind: "report.generate",
        refId: interviewId,
        payload: {
          subtype: "interview",
          interview_id: interviewId,
          report_id: report.id,
          simulation_id: report.simulation_id,
          agent_ref: input.agent_ref,
          question: input.question,
        },
        dedupeKey: `interview:${interviewId}`,
      });
      return { interview_id: interviewId, status: "pending" };
    });
  }

  @Get("v1/interviews/:id")
  @CanRead()
  async getInterview(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    return this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const { rows } = await client.query(
        `SELECT id, report_id, agent_ref, question, response, provenance, status, error, created_at, completed_at
         FROM interviews WHERE workspace_id = $1 AND id = $2`,
        [req.workspaceId, id],
      );
      if (!rows[0]) throw problems.notFound("interview");
      const row = rows[0] as { status: string; response: unknown };
      if (row.status === "pending") {
        return { interview: rows[0] };
      }
      // Responses always disclose provenance (RPT-06).
      return {
        interview: {
          ...rows[0],
          response: row.response
            ? { ...(row.response as object), provenance_disclosure: "synthetic agent output, not real-person testimony" }
            : null,
        },
      };
    });
  }
}
