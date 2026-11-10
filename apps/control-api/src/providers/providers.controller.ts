import { Body, Controller, Get, Inject, Param, Post, Put } from "@nestjs/common";
import pg from "pg";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { PG_APP_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { AuditService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";
import { CanManageProviders, CanRead, Req } from "../auth/rbac.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { MODEL_CATALOG_VERSION, PROVIDER_CATALOG, catalogModel } from "./catalog.js";
import { ProviderGateway } from "./provider-gateway.service.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { CacheService, CACHE_TTLS } from "../cache/cache.service.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";

const defaultsSchema = z.object({
  provider: z.enum(["gemini", "openrouter"]),
  model_allowlist: z.array(z.string()).min(1).max(20),
  data_policy: z.object({
    data_collection: z.enum(["allow", "deny"]).default("deny"),
    zdr: z.boolean().default(false),
  }),
  byok_key: z.string().max(200).optional(),
});

const validateSchema = z.object({
  provider: z.enum(["gemini", "openrouter"]),
  model_id: z.string().min(1),
});

/**
 * Local envelope encryption for BYOK at rest. Production replaces the key
 * provider with a managed KMS/envelope service (specs.md §14); the storage
 * shape (AES-256-GCM, random IV) is unchanged. Keys are write-only: never
 * returned by any API.
 */
export function envelopeEncrypt(plaintext: string, secret: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

export function envelopeDecrypt(payload: string, secret: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("invalid envelope payload");
  }
  const [, , ivB64, authB64, bodyB64] = parts as [string, string, string, string, string];
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
}

@Controller()
export class ProvidersController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(ProviderGateway) private readonly gateway: ProviderGateway,
    @Inject(ProviderConfigService) private readonly providerConfig: ProviderConfigService,
    @Inject(Tx) private readonly tx: Tx,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Get("v1/providers/catalog")
  @CanRead()
  async catalog() {
    // §12.3: provider catalog is global + catalog-version keyed, 5 min TTL,
    // safe stale-while-revalidate — models/policy are configuration, and the
    // catalog version travels in the key so a rollout self-invalidates.
    return this.cache.through(
      "catalog",
      "providers",
      { operationVersion: MODEL_CATALOG_VERSION },
      CACHE_TTLS.catalog,
      async () => ({
        catalog_version: MODEL_CATALOG_VERSION,
        providers: PROVIDER_CATALOG.map((p) => ({
          id: p.id,
          label: p.label,
          models: p.models.map((m) => ({
            id: m.id,
            label: m.label,
            structured_output: m.structuredOutput,
            context_window: m.contextWindow,
            data_policy: m.dataPolicy,
          })),
        })),
      }),
    );
  }

  @Get("v1/workspaces/:id/provider-defaults")
  @CanManageProviders()
  async getDefaults(@Req() req: TenantRequest, @Param("id") id: string) {
    this.assertScope(req, id);
    const generation = await this.cache.generation(id, "providers");
    return this.cache.through(
      "providers",
      "defaults",
      { workspaceId: id, authzEpoch: req.authzEpoch, parameters: { user_id: req.auth.userId }, generations: { providers: generation } },
      CACHE_TTLS.providerDefaults,
      async () =>
        this.tx.run({ workspaceId: id }, async (client) => {
          const { rows } = await client.query(
            `SELECT id, provider, model_allowlist, data_policy, is_default, validated_at, created_at, updated_at
             FROM provider_configs WHERE workspace_id = $1 ORDER BY updated_at DESC`,
            [id],
          );
          return {
            configs: rows,
            server_key_available: {
              gemini: this.config.GEMINI_API_KEY_REFERENCE.length > 0,
              openrouter: this.config.OPENROUTER_API_KEY_REFERENCE.length > 0,
            },
          };
        }),
    );
  }

  @Put("v1/workspaces/:id/provider-defaults")
  @CanManageProviders()
  async putDefaults(@Req() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    this.assertScope(req, id);
    const input = defaultsSchema.parse(body);
    for (const modelId of input.model_allowlist) {
      if (!catalogModel(input.provider, modelId)) {
        throw problems.validation(`Model ${modelId} is not in the server catalog`, {});
      }
    }
    const serverKey =
      input.provider === "gemini"
        ? this.config.GEMINI_API_KEY_REFERENCE
        : this.config.OPENROUTER_API_KEY_REFERENCE;
    if (!input.byok_key && !serverKey) {
      throw problems.validation(
        `No API key available for ${input.provider}: supply a workspace key or configure the server key`,
        {},
      );
    }
    return this.tx.run({ workspaceId: id, userId: req.auth.userId }, async (client) => {
      const encrypted = input.byok_key
        ? envelopeEncrypt(input.byok_key, this.config.SESSION_SECRET_REFERENCE)
        : null;
      await client.query(
        `UPDATE provider_configs SET is_default = false WHERE workspace_id = $1 AND provider = $2`,
        [id, input.provider],
      );
      const { rows } = await client.query(
        `INSERT INTO provider_configs (workspace_id, provider, model_allowlist, secret_ref, byok_encrypted, data_policy, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (workspace_id, id) DO NOTHING
         RETURNING id, provider, model_allowlist, data_policy, is_default, updated_at`,
        [
          id,
          input.provider,
          JSON.stringify(input.model_allowlist),
          input.byok_key ? "workspace-byok" : "server-key",
          encrypted,
          JSON.stringify(input.data_policy),
        ],
      );
      await client.query(`UPDATE workspaces SET authz_epoch = authz_epoch + 1 WHERE id = $1`, [id]);
      await this.cache.bumpGeneration(client, id, "providers");
      await this.audit.record(client, {
        workspaceId: id,
        actor: req.auth.userId,
        action: "provider.defaults.updated",
        targetType: "provider_config",
        targetId: rows[0]!.id as string,
        metadata: { provider: input.provider, allowlist: input.model_allowlist, byok: Boolean(input.byok_key) },
      });
      return { config: rows[0], applies_to: "new runs only" };
    });
  }

  @Post("v1/provider-configs/validate")
  @CanManageProviders()
  async validate(@Req() req: TenantRequest, @Body() body: unknown) {
    const input = validateSchema.parse(body);
    const model = catalogModel(input.provider, input.model_id);
    if (!model) throw problems.validation("Unknown provider or model", {});
    if (!model.structuredOutput) {
      throw problems.validation("Model does not support structured output", {});
    }
    const resolved = await this.providerConfig.resolve(req.workspaceId, input.provider);
    const health = await this.gateway.healthCheck(resolved);
    if (req.workspaceId) {
      await this.pool.query(
        `UPDATE provider_configs SET validated_at = CASE WHEN $3 THEN now() ELSE validated_at END
         WHERE workspace_id = $1 AND provider = $2`,
        [req.workspaceId, input.provider, health.ok],
      );
    }
    return {
      ok: health.ok,
      detail: health.detail,
      provider: input.provider,
      model_id: input.model_id,
      data_policy: resolved.dataPolicy,
    };
  }

  private assertScope(req: TenantRequest, id: string): void {
    if (req.workspaceId !== id) {
      throw problems.forbidden("Workspace context does not match the requested resource");
    }
  }
}
