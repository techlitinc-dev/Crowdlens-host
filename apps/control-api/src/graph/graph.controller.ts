import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import pg from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PG_APP_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { WorkService } from "../runner/work.service.js";
import { AuditService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";
import { CanRead, CanWriteProject, Req as TenantReq } from "../auth/rbac.js";
import { CacheService, CACHE_TTLS } from "../cache/cache.service.js";
import type { TenantRequest } from "../auth/auth-context.js";

const buildSchema = z.object({
  embedding_profile: z.string().max(120).default("ollama-nomic-embed-v1"),
});

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  kind: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Graph build control endpoints. The graph data plane lives behind the
 * GraphStorage port (graph_nodes/graph_edges tables locally; Neo4j adapter in
 * production) and is populated by the graph-worker from parsed chunks.
 */
@Controller("v1/projects/:projectId")
export class GraphController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Tx) private readonly tx: Tx,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Post("graph/build")
  @CanWriteProject()
  async build(@TenantReq() req: TenantRequest, @Param("projectId") projectId: string, @Body() body: unknown) {
    const input = buildSchema.parse(body ?? {});
    return this.tx.run({ workspaceId: req.workspaceId, userId: req.auth.userId }, async (client) => {
      const { rows: docs } = await client.query<{ sha256: string }>(
        `SELECT sha256 FROM documents
         WHERE workspace_id = $1 AND project_id = $2 AND parse_status = 'parsed'`,
        [req.workspaceId, projectId],
      );
      if (docs.length === 0) {
        throw problems.conflict("Upload and parse at least one document before building the graph");
      }
      const sourceSetHash = createHash("sha256")
        .update(docs.map((d) => d.sha256).sort().join(":"))
        .digest("hex");

      const { rows: existing } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM graphs
         WHERE workspace_id = $1 AND project_id = $2 AND source_set_hash = $3 AND status IN ('ready','building')
         ORDER BY created_at DESC LIMIT 1`,
        [req.workspaceId, projectId, sourceSetHash],
      );
      if (existing[0]) {
        return { graph_id: existing[0].id, status: existing[0].status, reused: true };
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO graphs (workspace_id, project_id, embedding_profile, source_set_hash, status)
         VALUES ($1, $2, $3, $4, 'building')
         RETURNING id`,
        [req.workspaceId, projectId, input.embedding_profile, sourceSetHash],
      );
      const graphId = rows[0]!.id;
      await client.query(
        `UPDATE projects SET stage = 'world', version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [req.workspaceId, projectId],
      );
      await this.audit.record(client, {
        workspaceId: req.workspaceId,
        actor: req.auth.userId,
        action: "graph.build.requested",
        targetType: "graph",
        targetId: graphId,
      });
      await this.work.enqueue({
        workspaceId: req.workspaceId,
        kind: "graph.build",
        refId: graphId,
        payload: { graph_id: graphId, project_id: projectId, source_set_hash: sourceSetHash, embedding_profile: input.embedding_profile },
        dedupeKey: `graph:${graphId}:${sourceSetHash}`,
      });
      // The project detail embeds the graphs list; a new build changes it.
      await this.cache.bumpGeneration(client, req.workspaceId, "projects");
      return { graph_id: graphId, status: "building", reused: false };
    });
  }

  @Get("graph")
  @CanRead()
  async get(@TenantReq() req: TenantRequest, @Param("projectId") projectId: string) {
    return this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const { rows: graphs } = await client.query(
        `SELECT id, embedding_profile, schema_version, source_set_hash, status, node_count, edge_count, created_at
         FROM graphs WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [req.workspaceId, projectId],
      );
      if (!graphs[0]) return { graph: null };
      const graph = graphs[0] as { id: string };
      const { rows: nodes } = await client.query(
        `SELECT node_id, kind, name, attrs FROM graph_nodes
         WHERE workspace_id = $1 AND graph_id = $2 ORDER BY kind, name LIMIT 500`,
        [req.workspaceId, graph.id],
      );
      const { rows: edges } = await client.query(
        `SELECT src, dst, kind, attrs FROM graph_edges
         WHERE workspace_id = $1 AND graph_id = $2 LIMIT 1000`,
        [req.workspaceId, graph.id],
      );
      return { graph: { ...graph, nodes, edges } };
    });
  }

  @Get(":projectId/graph/search")
  @CanRead()
  async search(
    @TenantReq() req: TenantRequest,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, string>,
  ) {
    const input = searchSchema.parse(query);
    const generation = await this.cache.generation(req.workspaceId, "graph");
    return this.cache.through(
      "graph",
      "search",
      {
        workspaceId: req.workspaceId,
        authzEpoch: req.authzEpoch,
        parameters: { project_id: projectId, q: input.q, kind: input.kind ?? "", limit: input.limit },
        generations: { graph: generation },
      },
      CACHE_TTLS.graphSearch,
      async () =>
        this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
          const { rows: graphs } = await client.query<{ id: string }>(
            `SELECT id FROM graphs
             WHERE workspace_id = $1 AND project_id = $2 AND status = 'ready'
             ORDER BY created_at DESC LIMIT 1`,
            [req.workspaceId, projectId],
          );
          const graphId = graphs[0]?.id;
          if (!graphId) return { graph_id: null, nodes: [], edges: [] };
          const kindClause = input.kind ? `AND kind = $4` : "";
          const params: unknown[] = input.kind
            ? [req.workspaceId, graphId, `%${input.q}%`, input.kind]
            : [req.workspaceId, graphId, `%${input.q}%`];
          const { rows: nodes } = await client.query(
            `SELECT node_id, kind, name, attrs FROM graph_nodes
             WHERE workspace_id = $1 AND graph_id = $2 AND name ILIKE $3 ${kindClause}
             ORDER BY name LIMIT ${input.limit}`,
            params as string[],
          );
          const nodeIds = nodes.map((n) => (n as { node_id: string }).node_id);
          let edges: unknown[] = [];
          if (nodeIds.length > 0) {
            const { rows } = await client.query(
              `SELECT src, dst, kind, attrs FROM graph_edges
               WHERE workspace_id = $1 AND graph_id = $2 AND src = ANY($3::text[]) AND dst = ANY($3::text[])
               LIMIT 200`,
              [req.workspaceId, graphId, nodeIds],
            );
            edges = rows;
          }
          return { graph_id: graphId, nodes, edges };
        }),
    );
  }
}
