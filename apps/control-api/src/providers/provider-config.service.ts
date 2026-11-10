import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "../db/pg.module.js";
import { problems } from "../common/problem-details.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import type { ResolvedProviderConfig } from "./provider-gateway.service.js";
import { envelopeDecrypt } from "./providers.controller.js";

/**
 * Resolves the effective provider configuration for a workspace: workspace
 * BYOK first, then the server-managed key. Keys never appear in any response.
 */
@Injectable()
export class ProviderConfigService {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async resolve(
    workspaceId: string,
    provider: "gemini" | "openrouter",
  ): Promise<ResolvedProviderConfig> {
    const { rows } = await this.pool.query<{
      model_allowlist: string[];
      data_policy: { data_collection: "allow" | "deny"; zdr: boolean };
      secret_ref: string;
      byok_encrypted: string | null;
    }>(
      `SELECT model_allowlist, data_policy, secret_ref, byok_encrypted
       FROM provider_configs WHERE workspace_id = $1 AND provider = $2 AND is_default = true
       ORDER BY updated_at DESC LIMIT 1`,
      [workspaceId, provider],
    );
    const row = rows[0];
    const serverKey =
      provider === "gemini"
        ? this.config.GEMINI_API_KEY_REFERENCE
        : this.config.OPENROUTER_API_KEY_REFERENCE;
    const apiKey =
      row?.byok_encrypted && row.secret_ref === "workspace-byok"
        ? envelopeDecrypt(row.byok_encrypted, this.config.SESSION_SECRET_REFERENCE)
        : serverKey;
    if (!apiKey) {
      throw problems.providerUnavailable(`No API key configured for ${provider}`);
    }
    return {
      provider,
      modelId:
        row?.model_allowlist[0] ??
        (provider === "gemini" ? "gemini-2.5-flash" : "openrouter/gpt-4o-mini"),
      apiKey,
      dataPolicy: row?.data_policy ?? { data_collection: "deny" as const, zdr: false },
    };
  }

  async allowlist(workspaceId: string, provider: string): Promise<string[] | null> {
    const { rows } = await this.pool.query<{ model_allowlist: string[] }>(
      `SELECT model_allowlist FROM provider_configs
       WHERE workspace_id = $1 AND provider = $2 AND is_default = true
       ORDER BY updated_at DESC LIMIT 1`,
      [workspaceId, provider],
    );
    return rows[0]?.model_allowlist ?? null;
  }
}
