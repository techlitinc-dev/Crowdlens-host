import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from "@nestjs/common";
import pg from "pg";
import { z } from "zod";
import type { Response } from "express";
import { Observable, interval } from "rxjs";
import { map, switchMap, takeWhile } from "rxjs/operators";
import { simulationConfigSchema, type SimulationStatus } from "@crowdlens/contracts";
import { PG_APP_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { AuditService } from "../audit/audit.service.js";
import { IdempotencyService } from "../common/idempotency.js";
import { problems } from "../common/problem-details.js";
import { CanRead, CanRun, Req as TenantReq } from "../auth/rbac.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { SimulationsService } from "./simulations.service.js";
import { estimateCredits, RATE_CARD } from "../billing/catalog.js";
import { LedgerService } from "../billing/ledger.service.js";
import { catalogModel } from "../providers/catalog.js";
import { ProviderConfigService } from "../providers/provider-config.service.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";

const estimateSchema = simulationConfigSchema.omit({ project_id: true });

type SimulationRowLike = {
  id: string;
  project_id: string;
  status: string;
  config: unknown;
  manifest: unknown;
  seed: number;
  rate_card_version: string;
  credits_reserved: number | null;
  credits_used: number;
  error: string | null;
  lineage_parent: string | null;
  created_at: Date;
  updated_at: Date;
};

@Controller("v1/simulations")
export class SimulationsController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(ProviderConfigService) private readonly providerConfig: ProviderConfigService,
    @Inject(SimulationsService) private readonly simulations: SimulationsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Tx) private readonly tx: Tx,
  ) {}

  private async resolveProvider(
    workspaceId: string,
    userId: string,
    requested: { provider?: string; model_id?: string },
  ): Promise<{ provider: string; modelId: string; dataPolicy: unknown }> {
    // Explicit per-run choice wins; otherwise workspace default; otherwise mock.
    if (requested.provider === "mock") {
      return {
        provider: "mock",
        modelId: requested.model_id ?? "mock-sim-1",
        dataPolicy: { data_collection: "deny", zdr: false },
      };
    }
    if (requested.provider) {
      const model = catalogModel(requested.provider, requested.model_id ?? "");
      if (!model) throw problems.validation("Unknown provider or model for this run", {});
      // Allowlist enforcement: workspace config may restrict models.
      const allowlist = await this.providerConfig.allowlist(workspaceId, requested.provider);
      if (allowlist && !allowlist.includes(model.id)) {
        throw problems.forbidden(`Model ${model.id} is not in the workspace allowlist`);
      }
      const resolved = await this.providerConfig.resolve(workspaceId, requested.provider as "gemini" | "openrouter");
      return { provider: requested.provider, modelId: model.id, dataPolicy: resolved.dataPolicy };
    }
    for (const provider of ["gemini", "openrouter"] as const) {
      try {
        const allowlist = await this.providerConfig.allowlist(workspaceId, provider);
        if (allowlist) {
          const resolved = await this.providerConfig.resolve(workspaceId, provider);
          return { provider, modelId: allowlist[0] ?? resolved.modelId, dataPolicy: resolved.dataPolicy };
        }
      } catch {
        // fall through to mock
      }
    }
    return { provider: "mock", modelId: "mock-sim-1", dataPolicy: { data_collection: "deny", zdr: false } };
  }

  /** Pre-purchase estimate: same math as settlement rates, shown with version. */
  @Post("estimate")
  @CanRun()
  async estimate(@TenantReq() req: TenantRequest, @Body() body: unknown) {
    const input = estimateSchema.parse(body);
    const provider = input.provider ?? "mock";
    const estimate = estimateCredits({
      population: input.population,
      activeBudget: input.active_budget,
      ticks: input.ticks,
      reportDepth: input.report_depth,
      provider,
      documentPages: input.assumptions ? Math.max(1, Math.ceil(input.assumptions.length / 2500)) : 5,
    });
    const hardCap = Math.min(input.max_credits, Math.ceil(estimate.high * 1.25));
    const driverTotal = estimate.drivers.reduce((sum, d) => sum + d.credits, 0);
    const drivers = [
      ...estimate.drivers,
      { factor: "provider/model class", credits: Math.max(0, estimate.high - driverTotal) },
    ];
    return {
      rate_card_version: RATE_CARD.version,
      credits_low: estimate.low,
      credits_high: estimate.high,
      hard_cap: Math.max(1, hardCap),
      drivers,
      estimate_only: true,
    };
  }

  @Post()
  @CanRun()
  async create(
    @TenantReq() req: TenantRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const config = simulationConfigSchema.parse(body);
    const key = idempotencyKey ?? `sim:${req.auth.userId}:${config.project_id}:${JSON.stringify(config).length}`;
    const resolved = await this.resolveProvider(req.workspaceId, req.auth.userId, config);
    const { value, replayed } = await this.idempotency.run(
      { workspaceId: req.workspaceId, actor: req.auth.userId, route: "POST /v1/simulations", key, statusCode: 201 },
      async () => {
        const result = await this.simulations.create({
          workspaceId: req.workspaceId,
          userId: req.auth.userId,
          config,
          resolvedProvider: resolved,
          manifestExtras: { decision_question: config.decision_question },
        });
        await this.audit.recordStandalone({
          workspaceId: req.workspaceId,
          actor: req.auth.userId,
          action: result.existing ? "simulation.duplicate_returned" : "simulation.created",
          targetType: "simulation",
          targetId: result.simulation.id,
          requestId: req.requestId,
          metadata: { provider: resolved.provider, model_id: resolved.modelId },
        });
        return {
          simulation: this.present(result.simulation),
          existing: result.existing,
          provider: resolved,
        };
      },
    );
    return { ...(value as object), idempotent_replay: replayed };
  }

  @Get(":id")
  @CanRead()
  async get(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    const simulation = await this.simulations.get(req.workspaceId, id);
    if (!simulation) throw problems.notFound("simulation");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [req.workspaceId]);
      const { rows: shards } = await client.query(
        `SELECT shard_index, status, tick, checkpoint_key, heartbeat_at
         FROM simulation_shards WHERE workspace_id = $1 AND simulation_id = $2 ORDER BY shard_index`,
        [req.workspaceId, id],
      );
      const { rows: reservation } = await client.query(
        `SELECT id, amount, status FROM credit_reservations
         WHERE workspace_id = $1 AND simulation_id = $2`,
        [req.workspaceId, id],
      );
      const { rows: report } = await client.query(
        `SELECT id, version, content_hash, status FROM reports
         WHERE workspace_id = $1 AND simulation_id = $2 ORDER BY version DESC LIMIT 1`,
        [req.workspaceId, id],
      );
      await client.query("COMMIT");
      return {
        simulation: this.present(simulation),
        shards,
        reservation: reservation[0] ?? null,
        report: report[0] ?? null,
      };
    } finally {
      client.release();
    }
  }

  /** Durable event log: JSON polling (default) or SSE stream (Accept: text/event-stream). */
  @Get(":id/events")
  @CanRead()
  async events(
    @TenantReq() req: TenantRequest,
    @Param("id") id: string,
    @Query("after") after: string | undefined,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Headers("accept") accept: string | undefined,
    @Res() res: Response,
  ) {
    const afterSeq = Number(after ?? lastEventId ?? 0) || 0;
    const wantsSse = accept?.includes("text/event-stream");
    const simulation = await this.simulations.get(req.workspaceId, id);
    if (!simulation) throw problems.notFound("simulation");

    const readNew = async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [req.workspaceId]);
        // Re-authorise per batch: membership may have been revoked mid-stream.
        const { rows: membership } = await this.pool.query(
          `SELECT role FROM get_membership($1::uuid, $2::uuid) WHERE workspace_status = 'active'`,
          [req.workspaceId, req.auth.userId],
        );
        if (!membership[0]) return { revoked: true as const, events: [] };
        const { rows } = await client.query(
          `SELECT seq, type, tick, shard, payload, created_at
           FROM simulation_events
           WHERE workspace_id = $1 AND simulation_id = $2 AND seq > $3
           ORDER BY seq ASC LIMIT 200`,
          [req.workspaceId, id, afterSeq],
        );
        await client.query("COMMIT");
        return { revoked: false as const, events: rows };
      } finally {
        client.release();
      }
    };

    if (!wantsSse) {
      const { revoked, events } = await readNew();
      if (revoked) throw problems.forbidden("Membership revoked");
      res.json({ events, simulation_status: simulation.status });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = interval(1500).pipe(
      switchMap(() => readNew()),
      takeWhile(({ revoked }) => {
        if (revoked) {
          res.write(`event: authz_revoked\ndata: {}\n\n`);
          res.end();
          return false;
        }
        return true;
      }, true),
      map(({ events }) => events as { seq: number; type: string; payload: Record<string, unknown> }[]),
      takeWhile(() => !res.writableEnded),
    );
    const subscription = stream.subscribe({
      next: (events) => {
        for (const event of events) {
          res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        }
      },
      error: () => res.end(),
      complete: () => res.end(),
    });
    res.on("close", () => subscription.unsubscribe());
  }

  @Post(":id/cancel")
  @CanRun()
  async cancel(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    await this.simulations.cancel(req.workspaceId, req.auth.userId, id);
    await this.audit.recordStandalone({
      workspaceId: req.workspaceId,
      actor: req.auth.userId,
      action: "simulation.cancel_requested",
      targetType: "simulation",
      targetId: id,
      requestId: req.requestId,
    });
    return { cancelled: true, note: "Consumed work is billed; unused reservation is released." };
  }

  /** Clone from a valid configuration with a new provider/model (lineage kept). */
  @Post(":id/clone")
  @CanRun()
  async clone(@TenantReq() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    const source = await this.simulations.get(req.workspaceId, id);
    if (!source) throw problems.notFound("simulation");
    const override = z
      .object({ provider: z.enum(["gemini", "openrouter", "mock"]).optional(), model_id: z.string().optional(), max_credits: z.number().int().positive().optional() })
      .parse(body ?? {});
    const config = {
      ...source.config,
      ...(override.provider ? { provider: override.provider } : {}),
      ...(override.model_id ? { model_id: override.model_id } : {}),
      ...(override.max_credits ? { max_credits: override.max_credits } : {}),
    };
    const resolved = await this.resolveProvider(req.workspaceId, req.auth.userId, config);
    const result = await this.simulations.create({
      workspaceId: req.workspaceId,
      userId: req.auth.userId,
      config: simulationConfigSchema.parse(config),
      resolvedProvider: resolved,
      manifestExtras: { lineage_parent: id, decision_question: config.decision_question },
    });
    await this.pool.query(
      `UPDATE simulations SET lineage_parent = $3 WHERE workspace_id = $1 AND id = $2`,
      [req.workspaceId, result.simulation.id, id],
    );
    return { simulation: this.present(result.simulation), cloned_from: id, existing: result.existing };
  }

  private present(row: SimulationRowLike) {
    return {
      id: row.id,
      project_id: row.project_id,
      status: row.status,
      config: row.config,
      manifest: row.manifest,
      seed: row.seed,
      rate_card_version: row.rate_card_version,
      credits_reserved: row.credits_reserved,
      credits_used: row.credits_used,
      error: row.error,
      lineage_parent: row.lineage_parent,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
