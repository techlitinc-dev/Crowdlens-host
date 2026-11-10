import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Res,
  Req as NestReq,
} from "@nestjs/common";
import { Req } from "../auth/rbac.js";
import pg from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Response } from "express";
import { PG_APP_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { OBJECT_STORAGE, tenantKey, type ObjectStorage } from "../storage/storage.service.js";
import { WorkService } from "../runner/work.service.js";
import { AuditService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";
import { CanRead, CanWriteProject } from "../auth/rbac.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { planByCode } from "../billing/catalog.js";
import { CacheService } from "../cache/cache.service.js";

const SUPPORTED_MIME = new Set([
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/x-markdown",
]);

const initSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(100),
  size_bytes: z.number().int().min(1).max(100 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const PARSER_VERSION = "parse-v1";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Controller()
export class DocumentsController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(AuditService) private readonly audit: AuditService,
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

  /** Step 1: register intent; returns reuse info or an upload target. */
  @Post("v1/projects/:projectId/documents/init")
  @CanWriteProject()
  async init(@Req() req: TenantRequest, @Param("projectId") projectId: string, @Body() body: unknown) {
    const input = initSchema.parse(body);
    if (!SUPPORTED_MIME.has(input.mime_type)) {
      throw problems.validation(`Unsupported document type: ${input.mime_type}`, {
        supported: [...SUPPORTED_MIME],
      });
    }
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const plan = await this.planFor(client, req.workspaceId);
      if (input.size_bytes > plan.maxDocumentMb * 1024 * 1024) {
        throw problems.validation(
          `Document exceeds the ${plan.maxDocumentMb} MB limit of plan ${plan.code}`,
          { limit_mb: plan.maxDocumentMb },
        );
      }
      const project = await client.query(
        `SELECT id FROM projects WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [req.workspaceId, projectId],
      );
      if (!project.rows[0]) throw problems.notFound("project");

      const { rows: existing } = await client.query(
        `SELECT id, parse_status, parse_artifact_key FROM documents
         WHERE workspace_id = $1 AND sha256 = $2 AND parse_status = 'parsed' LIMIT 1`,
        [req.workspaceId, input.sha256],
      );
      const { rows: countRows } = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM documents WHERE workspace_id = $1 AND project_id = $2`,
        [req.workspaceId, projectId],
      );
      if (countRows[0]!.count >= plan.maxDocumentsPerProject) {
        throw problems.conflict(`Plan ${plan.code} allows ${plan.maxDocumentsPerProject} documents per project`);
      }

      const reuse = existing[0] ?? null;
      const { rows } = await client.query(
        `INSERT INTO documents (workspace_id, project_id, filename, mime_type, size_bytes, sha256, object_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, filename, mime_type, size_bytes, sha256, parse_status, object_key, created_at`,
        [
          req.workspaceId,
          projectId,
          input.filename,
          input.mime_type,
          input.size_bytes,
          input.sha256,
          tenantKey(req.workspaceId, "documents", `${crypto.randomUUID()}`),
          req.auth.userId,
        ],
      );
      const document = rows[0]!;
      if (reuse?.parse_artifact_key) {
        await client.query(
          `UPDATE documents SET parse_status = 'parsed', parse_artifact_key = $1 WHERE workspace_id = $2 AND id = $3`,
          [reuse.parse_artifact_key, req.workspaceId, document.id as string],
        );
      }
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "document.init",
        targetType: "document",
        targetId: document.id as string,
        metadata: { filename: input.filename, reused_parse: Boolean(reuse) },
      });
      // The project detail embeds the documents list.
      await this.cache.bumpGeneration(client, req.workspaceId, "projects");
      return {
        document: { ...document, parse_status: reuse ? "parsed" : "uploaded" },
        upload: reuse ? null : { mode: "direct", method: "PUT", path: `/v1/documents/${document.id}/content` },
        parse_reused: Boolean(reuse),
      };
    });
  }

  /** Step 2: upload bytes (server verifies content hash — DOC-03). */
  @Put("v1/documents/:id/content")
  @CanWriteProject()
  async content(
    @NestReq() rawReq: { body?: unknown; tenant: TenantRequest },
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenant = rawReq.tenant;
    const body = rawReq.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw problems.validation("Request body must be the raw document bytes", {});
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      throw problems.validation("Document exceeds the maximum upload size", {});
    }
    return this.tx.run({ workspaceId: tenant.workspaceId, userId: tenant.auth.userId }, async (client) => {
      const { rows } = await client.query<{
        id: string;
        object_key: string;
        sha256: string;
        parse_status: string;
      }>(
        `SELECT id, object_key, sha256, parse_status FROM documents
         WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [tenant.workspaceId, id],
      );
      const document = rows[0];
      if (!document) throw problems.notFound("document");
      if (document.parse_status !== "uploaded") {
        throw problems.conflict("Document already uploaded");
      }
      const actual = createHash("sha256").update(body).digest("hex");
      if (actual !== document.sha256) {
        throw problems.validation("Content hash does not match the registered sha256", {
          expected: document.sha256,
          actual,
        });
      }
      // Active-content hygiene: documents are stored opaque; parsing treats
      // content as untrusted data (§3.1). Encrypted-PDF/malformed detection
      // happens in the isolated parser worker.
      await this.storage.put(document.object_key, body, "application/octet-stream");
      await client.query(
        `UPDATE documents SET parse_status = 'parsing' WHERE workspace_id = $1 AND id = $2`,
        [tenant.workspaceId, id],
      );
      await this.work.enqueue({
        workspaceId: tenant.workspaceId,
        kind: "document.parse",
        refId: id,
        payload: { document_id: id, sha256: document.sha256, parser_version: PARSER_VERSION },
        dedupeKey: `${id}:${document.sha256}:${PARSER_VERSION}`,
      });
      await this.audit.record(client, {
        workspaceId: tenant.workspaceId,
        actor: tenant.auth.userId,
        action: "document.uploaded",
        targetType: "document",
        targetId: id,
        metadata: { bytes: body.length },
      });
      await this.cache.bumpGeneration(client, tenant.workspaceId, "projects");
      res.setHeader("Cache-Control", "private, no-store");
      return { document_id: id, parse_status: "parsing" };
    });
  }

  @Get("v1/documents/:id")
  @CanRead()
  async get(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, filename, mime_type, size_bytes, sha256, parse_status, created_at
         FROM documents WHERE workspace_id = $1 AND id = $2`,
        [req.workspaceId, id],
      );
      if (!rows[0]) throw problems.notFound("document");
      return { document: rows[0] };
    });
  }

  /** Parsed chunks with source locators (DOC-04) — powers report citations. */
  @Get("v1/documents/:id/chunks")
  @CanRead()
  async chunks(@Req() req: TenantRequest, @Param("id") id: string) {
    return this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const { rows } = await client.query<{ parse_artifact_key: string | null }>(
        `SELECT parse_artifact_key FROM documents WHERE workspace_id = $1 AND id = $2`,
        [req.workspaceId, id],
      );
      const key = rows[0]?.parse_artifact_key;
      if (!key) throw problems.notFound("parse artifact");
      const artifact = await this.storage.get(key);
      return JSON.parse(artifact.toString("utf8"));
    });
  }
}
