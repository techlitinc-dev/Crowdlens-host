import { Inject, Injectable, Logger } from "@nestjs/common";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { assertLegalTransition, type SimulationConfig, type SimulationStatus } from "@crowdlens/contracts";
import { PG_APP_POOL } from "../db/pg.module.js";
import { problems } from "../common/problem-details.js";
import { estimateCredits, planByCode, RATE_CARD } from "../billing/catalog.js";
import { LedgerService } from "../billing/ledger.service.js";
import { WorkService } from "../runner/work.service.js";
import { CacheService } from "../cache/cache.service.js";
import { MODEL_CATALOG_VERSION, MOCK_MODEL_ID, catalogModel } from "../providers/catalog.js";
import type { ProvidersController } from "../providers/providers.controller.js";

export interface SimulationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  config: SimulationConfig;
  manifest: Record<string, unknown>;
  status: SimulationStatus;
  seed: number;
  rate_card_version: string;
  credits_reserved: number | null;
  credits_used: number;
  error: string | null;
  lineage_parent: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SimulationsService {
  private readonly logger = new Logger("simulations");

  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /** Stable config hash for idempotent run creation (dedupe + replay). */
  configHash(input: {
    projectId: string;
    config: SimulationConfig;
    manifest: Record<string, unknown>;
    seed: number;
  }): string {
    const canonical = JSON.stringify({
      project: input.projectId,
      config: input.config,
      manifest: {
        provider: input.manifest["provider"],
        model_id: input.manifest["model_id"],
        model_revision: input.manifest["model_revision"],
        prompt_bundle_version: input.manifest["prompt_bundle_version"],
        structured_schema_version: input.manifest["structured_schema_version"],
        embedding_profile_id: input.manifest["embedding_profile_id"],
        rate_card_version: input.manifest["rate_card_version"],
      },
      seed: input.seed,
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  async create(input: {
    workspaceId: string;
    userId: string;
    config: SimulationConfig;
    resolvedProvider: { provider: string; modelId: string; dataPolicy: unknown };
    manifestExtras: Record<string, unknown>;
  }): Promise<{ simulation: SimulationRow; existing: boolean }> {
    const { config } = input;
    const seed = config.seed_policy === "fixed" && config.seed !== undefined
      ? config.seed
      : Math.floor(Math.random() * 2 ** 31);

    const model = catalogModel(input.resolvedProvider.provider, input.resolvedProvider.modelId);
    const manifest = {
      schema_version: 1,
      provider: input.resolvedProvider.provider,
      model_id: input.resolvedProvider.modelId,
      model_revision: model ? `${MODEL_CATALOG_VERSION}:${createHash("sha256").update(JSON.stringify(model)).digest("hex").slice(0, 12)}` : "unknown",
      prompt_bundle_version: process.env.PROMPT_BUNDLE_VERSION || "prompts-2026-11-09",
      structured_schema_version: "schema-persona-v1",
      embedding_profile_id: "ollama-nomic-embed-v1",
      routing_policy: input.resolvedProvider.dataPolicy ?? {},
      random_seed: seed,
      rate_card_version: RATE_CARD.version,
      ...input.manifestExtras,
    };
    const configHash = this.configHash({ projectId: config.project_id, config, manifest, seed });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);

      const project = await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [input.workspaceId, config.project_id],
      );
      if (!project.rows[0]) {
        await client.query("ROLLBACK");
        throw problems.notFound("project");
      }

      // Duplicate submission returns the existing run (architecture.md §7).
      const { rows: existing } = await client.query<SimulationRow>(
        `SELECT * FROM simulations
         WHERE workspace_id = $1 AND project_id = $2 AND config_hash = $3 AND status NOT IN ('failed','cancelled')
         ORDER BY created_at DESC LIMIT 1`,
        [input.workspaceId, config.project_id, configHash],
      );
      if (existing[0]) {
        await client.query("ROLLBACK");
        return { simulation: existing[0], existing: true };
      }

      const plan = planByCode(
        (await client.query(`SELECT plan_code FROM workspaces WHERE id = $1`, [input.workspaceId])).rows[0]?.["plan_code"] ?? "explorer",
      )!;
      if (config.population > plan.agentCeiling) {
        await client.query("ROLLBACK");
        throw problems.validation(
          `Plan ${plan.code} supports up to ${plan.agentCeiling.toLocaleString()} logical agents; this run requests ${config.population.toLocaleString()}.`,
          { plan: plan.code, ceiling: plan.agentCeiling },
        );
      }
      const { rows: activeRuns } = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM simulations
         WHERE workspace_id = $1 AND status IN ('queued','preparing','running')`,
        [input.workspaceId],
      );
      if (activeRuns[0]!.count >= plan.maxConcurrentRuns) {
        await client.query("ROLLBACK");
        throw problems.conflict(
          `Plan ${plan.code} allows ${plan.maxConcurrentRuns} concurrent run(s); wait for an active run to finish.`,
        );
      }

      // Estimate + hard cap; reserve the authorised maximum atomically.
      const estimate = estimateCredits({
        population: config.population,
        activeBudget: config.active_budget,
        ticks: config.ticks,
        reportDepth: config.report_depth,
        provider: input.resolvedProvider.provider,
      });
      const hardCap = Math.max(1, Math.min(config.max_credits, Math.ceil(estimate.high * 1.25)));

      const simulationId = randomUUID();
      const { rows } = await client.query<SimulationRow>(
        `INSERT INTO simulations
           (workspace_id, id, project_id, config_hash, config, manifest, status, seed, rate_card_version, credits_reserved)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9)
         RETURNING *`,
        [
          input.workspaceId,
          simulationId,
          config.project_id,
          configHash,
          JSON.stringify(config),
          JSON.stringify(manifest),
          seed,
          RATE_CARD.version,
          hardCap,
        ],
      );
      // New runs appear in the project detail's simulations list — bump in
      // the same transaction so the invalidation is atomic with the insert.
      await this.cache.bumpGeneration(client, input.workspaceId, "projects");
      await client.query("COMMIT");
      const simulation = rows[0]!;

      // Reservation is its own transaction (locks wallet; §11.2 ordering).
      await this.ledger.reserve({
        workspaceId: input.workspaceId,
        simulationId,
        amount: hardCap,
        rateCardVersion: RATE_CARD.version,
        actor: input.userId,
      });
      await this.pool.query(
        `UPDATE simulations SET reservation_id = (
           SELECT id FROM credit_reservations WHERE simulation_id = $1
         ) WHERE id = $1`,
        [simulationId],
      );

      await this.work.enqueue({
        workspaceId: input.workspaceId,
        kind: "simulation.stage",
        refId: simulationId,
        payload: { simulation_id: simulationId, stage: "prepare", config, manifest },
        dedupeKey: `sim:${simulationId}:prepare`,
      });
      const eventClient = await this.pool.connect();
      try {
        await eventClient.query("BEGIN");
        await eventClient.query(`SELECT set_config('app.workspace_id', $1, true)`, [input.workspaceId]);
        await eventClient.query(
          `INSERT INTO simulation_events (workspace_id, simulation_id, type, payload, authz_epoch)
           VALUES ($1, $2, 'stage_changed', $3, (SELECT authz_epoch FROM workspaces WHERE id = $1))`,
          [input.workspaceId, simulationId, JSON.stringify({ status: "queued" })],
        );
        await eventClient.query("COMMIT");
      } finally {
        eventClient.release();
      }
      return { simulation, existing: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Worker-facing status transition with legal-transition enforcement. */
  async transition(
    workspaceId: string,
    simulationId: string,
    to: SimulationStatus,
    error?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [workspaceId]);
      const { rows } = await client.query<{ status: SimulationStatus }>(
        `SELECT status FROM simulations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, simulationId],
      );
      const from = rows[0]?.status;
      if (!from) throw problems.notFound("simulation");
      if (from === to) {
        await client.query("COMMIT");
        return;
      }
      assertLegalTransition(from, to);
      await client.query(
        `UPDATE simulations SET status = $3, error = $4, updated_at = now(),
           started_at = CASE WHEN $3 IN ('running') AND started_at IS NULL THEN now() ELSE started_at END,
           completed_at = CASE WHEN $3 IN ('completed','failed','cancelled') THEN now() ELSE completed_at END
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, simulationId, to, error ?? null],
      );
      await client.query(
        `INSERT INTO simulation_events (workspace_id, simulation_id, type, payload, authz_epoch)
         VALUES ($1, $2, 'stage_changed', $3, (SELECT authz_epoch FROM workspaces WHERE id = $1))`,
        [workspaceId, simulationId, JSON.stringify({ status: to, ...(error ? { error } : {}) })],
      );
      await client.query("COMMIT");
    } catch (transitionError) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw transitionError;
    } finally {
      client.release();
    }
  }

  async get(workspaceId: string, simulationId: string): Promise<SimulationRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [workspaceId]);
      const { rows } = await client.query<SimulationRow>(
        `SELECT * FROM simulations WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, simulationId],
      );
      await client.query("COMMIT");
      return rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  async cancel(workspaceId: string, userId: string, simulationId: string): Promise<void> {
    const simulation = await this.get(workspaceId, simulationId);
    if (!simulation) throw problems.notFound("simulation");
    const cancellable: SimulationStatus[] = ["queued", "preparing", "running", "paused", "draft"];
    if (!cancellable.includes(simulation.status)) {
      throw problems.conflict(`Run is already ${simulation.status}`);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.workspace_id', $1, true)`, [workspaceId]);
      await client.query(
        `UPDATE simulations SET cancel_requested_at = now(), updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, simulationId],
      );
      await client.query(
        `INSERT INTO simulation_events (workspace_id, simulation_id, type, payload, authz_epoch)
         VALUES ($1, $2, 'cancel_requested', '{}', (SELECT authz_epoch FROM workspaces WHERE id = $1))`,
        [workspaceId, simulationId],
      );
      await this.cache.bumpGeneration(client, workspaceId, "projects");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await this.work.cancelForSimulation(workspaceId, simulationId);
    // Queued runs settle immediately; running runs settle at the next checkpoint.
    if (simulation.status === "queued" || simulation.status === "draft") {
      await this.ledger.release({
        workspaceId,
        simulationId,
        rateCardVersion: RATE_CARD.version,
        actor: userId,
      });
      await this.transition(workspaceId, simulationId, "cancelled");
    }
  }
}

export const MOCK_MANIFEST_PROVIDER = MOCK_MODEL_ID;
