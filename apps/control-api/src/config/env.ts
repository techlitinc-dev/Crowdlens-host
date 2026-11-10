/**
 * Configuration contract (instructions.md §6). Environment is read ONCE here
 * and injected; domain code never touches process.env.
 */
import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  CONTROL_API_ORIGIN: z.string().url().default("http://localhost:4000"),

  OIDC_ISSUER: z.string().default(""),
  OIDC_CLIENT_ID: z.string().default(""),
  OIDC_CLIENT_SECRET: z.string().default(""),
  SESSION_SECRET_REFERENCE: z.string().min(8).default("dev-session-secret-change-me"),

  DATABASE_URL: z.string().default("postgres://crowdlens:crowdlens@localhost:5432/crowdlens"),
  EMBEDDED_PG_DATA_DIR: z.string().default(""),
  EMBEDDED_PG_PORT: z.coerce.number().int().default(55432),

  NEO4J_URI: z.string().default(""),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD_REFERENCE: z.string().default(""),

  REDIS_URL: z.string().default(""),
  TEMPORAL_ADDRESS: z.string().default(""),

  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("crowdlens-artifacts"),
  S3_ACCESS_KEY_REFERENCE: z.string().default(""),
  S3_SECRET_KEY_REFERENCE: z.string().default(""),
  STORAGE_FS_DIR: z.string().default(".data/objects"),

  GEMINI_API_KEY_REFERENCE: z.string().default(""),
  OPENROUTER_API_KEY_REFERENCE: z.string().default(""),
  OPENROUTER_APP_URL: z.string().url().default("http://localhost:3000"),
  OPENROUTER_APP_NAME: z.string().default("CrowdLens"),

  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET_REFERENCE: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET_REFERENCE: z.string().default(""),
  RAZORPAY_MODE: z.enum(["test", "live"]).default("test"),

  CREDIT_RATE_CARD_VERSION: z.string().default("credits-2026-11-09"),
  MODEL_CATALOG_VERSION: z.string().default("models-2026-11-09"),
  PROMPT_BUNDLE_VERSION: z.string().default("prompts-2026-11-09"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  /** True when running against a local development identity provider. */
  devIdentity: boolean;
  /** True when Razorpay credentials are configured. */
  razorpayConfigured: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const config: AppConfig = {
    ...parsed,
    devIdentity: parsed.OIDC_ISSUER.length === 0,
    razorpayConfigured:
      parsed.RAZORPAY_KEY_ID.length > 0 && parsed.RAZORPAY_KEY_SECRET_REFERENCE.length > 0,
  };
  return config;
}

export const CONFIG_TOKEN = "APP_CONFIG";

/** Non-secret configuration summary for startup logs (§6). */
export function configSummary(config: AppConfig): Record<string, unknown> {
  return {
    app_env: config.APP_ENV,
    web_origin: config.WEB_ORIGIN,
    control_api_origin: config.CONTROL_API_ORIGIN,
    identity: config.devIdentity ? "dev" : "oidc",
    database: config.EMBEDDED_PG_DATA_DIR
      ? `embedded(${config.EMBEDDED_PG_DATA_DIR})`
      : "postgres(url)",
    redis: config.REDIS_URL ? "redis" : "in-memory",
    object_storage: config.S3_ENDPOINT ? "s3" : `filesystem(${config.STORAGE_FS_DIR})`,
    graph_store: config.NEO4J_URI ? "neo4j" : "relational",
    razorpay: config.razorpayConfigured ? config.RAZORPAY_MODE : "not-configured",
    rate_card_version: config.CREDIT_RATE_CARD_VERSION,
    model_catalog_version: config.MODEL_CATALOG_VERSION,
    prompt_bundle_version: config.PROMPT_BUNDLE_VERSION,
  };
}
