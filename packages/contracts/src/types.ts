import { z } from "zod";

/**
 * Zod validators mirroring the JSON Schema sources in ../schemas.
 * These are the runtime-validated TypeScript contract surface; the Python
 * mirror lives in ../python/crowdlens_contracts/models.py and both sides are
 * pinned to the same golden fixtures.
 */

export const uuidSchema = z.string().uuid();

export const providerIdSchema = z.enum(["gemini", "openrouter", "mock"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const roleSchema = z.enum(["owner", "admin", "analyst", "viewer", "billing_admin"]);
export type Role = z.infer<typeof roleSchema>;
export const ROLES: Role[] = ["owner", "admin", "analyst", "viewer", "billing_admin"];

export const runManifestSchema = z.object({
  schema_version: z.literal(1),
  provider: providerIdSchema,
  model_id: z.string().min(1),
  model_revision: z.string().min(1),
  prompt_bundle_version: z.string().min(1),
  structured_schema_version: z.string().min(1),
  embedding_profile_id: z.string().min(1),
  routing_policy: z.record(z.unknown()).default({}),
  random_seed: z.number().int(),
  rate_card_version: z.string().min(1),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export const simulationConfigSchema = z.object({
  project_id: uuidSchema,
  decision_question: z.string().min(8).max(2000),
  target_audience: z.string().max(1000).optional(),
  platforms: z.array(z.string()).max(16).optional(),
  assumptions: z.string().max(4000).optional(),
  population: z.number().int().min(100).max(1_000_000),
  active_budget: z.number().int().min(16).max(100_000).default(256),
  reasoning_depth: z.enum(["standard", "deep"]).default("standard"),
  ticks: z.number().int().min(1).max(200).default(24),
  seed_policy: z.enum(["random", "fixed"]).default("random"),
  seed: z.number().int().optional(),
  provider: providerIdSchema.optional(),
  model_id: z.string().optional(),
  report_depth: z.enum(["standard", "detailed"]).default("standard"),
  max_credits: z.number().int().min(1).max(1_000_000).default(500),
});
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const estimateSchema = z.object({
  rate_card_version: z.string(),
  credits_low: z.number().int().min(0),
  credits_high: z.number().int().min(0),
  hard_cap: z.number().int().min(1),
  drivers: z.array(
    z.object({ factor: z.string(), credits: z.number().int() }),
  ),
});
export type SimulationEstimate = z.infer<typeof estimateSchema>;

export const structuredGenerationRequestSchema = z.object({
  provider: providerIdSchema,
  model_id: z.string().min(1),
  prompt_prefix: z.string(),
  prompt_suffix: z.string(),
  json_schema: z.record(z.unknown()),
  schema_version: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  max_output_tokens: z.number().int().min(1).default(2048),
  session_id: z.string().optional(),
  data_policy: z
    .object({ data_collection: z.enum(["allow", "deny"]), zdr: z.boolean() })
    .optional(),
});
export type StructuredGenerationRequest = z.infer<typeof structuredGenerationRequestSchema>;

export const tokenUsageSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cached_input_tokens: z.number().int().min(0).default(0),
  cost_estimate_micro_usd: z.number().int().optional(),
  usage_is_estimate: z.boolean().default(false),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const structuredGenerationResultSchema = z.object({
  data: z.unknown(),
  provider: providerIdSchema,
  model_id: z.string(),
  endpoint: z.string().optional(),
  request_id: z.string().optional(),
  latency_ms: z.number().int().min(0),
  retries: z.number().int().min(0).default(0),
  usage: tokenUsageSchema,
  cache_metadata: z.record(z.unknown()).optional(),
  raw_artifact_ref: z.string().optional(),
});
export type StructuredGenerationResult = z.infer<typeof structuredGenerationResultSchema>;

export const eventEnvelopeSchema = z.object({
  event_id: uuidSchema,
  event_type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  event_version: z.number().int().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  workspace_id: uuidSchema,
  aggregate_id: z.string().min(1),
  correlation_id: z.string().optional(),
  causation_id: z.string().optional(),
  payload: z.record(z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const ledgerEntryTypeSchema = z.enum([
  "plan_grant",
  "topup_grant",
  "reservation",
  "reservation_release",
  "usage_debit",
  "adjustment",
  "expiration",
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeSchema>;

export const ledgerEntrySchema = z.object({
  workspace_id: uuidSchema,
  entry_type: ledgerEntryTypeSchema,
  amount: z.number().int(),
  idempotency_key: z.string().min(8).max(200),
  rate_card_version: z.string(),
  actor: z.string().optional(),
  event_ref: z.string().optional(),
  simulation_id: z.string().optional(),
  reason: z.string().optional(),
  occurred_at: z.string().datetime({ offset: true }),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const simulationStatusSchema = z.enum([
  "draft",
  "queued",
  "preparing",
  "running",
  "finalizing",
  "completed",
  "paused",
  "failed",
  "cancelled",
]);
export type SimulationStatus = z.infer<typeof simulationStatusSchema>;

export const LEGAL_RUN_TRANSITIONS: Record<SimulationStatus, SimulationStatus[]> = {
  draft: ["queued"],
  queued: ["preparing", "cancelled", "failed"],
  preparing: ["running", "cancelled", "failed"],
  running: ["finalizing", "paused", "cancelled", "failed"],
  paused: ["running", "cancelled", "failed"],
  finalizing: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function assertLegalTransition(from: SimulationStatus, to: SimulationStatus): void {
  const allowed = LEGAL_RUN_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`illegal simulation transition: ${from} -> ${to}`);
  }
}

// ---- Report evidence model (architecture.md §13) ----

export const provenanceTypeSchema = z.enum([
  "source_chunk",
  "event_aggregate",
  "active_agent_response",
  "model_inference",
]);
export type ProvenanceType = z.infer<typeof provenanceTypeSchema>;

export const provenanceItemSchema = z.object({
  type: provenanceTypeSchema,
  id: z.string().min(1),
  relation: z.enum(["context", "supports", "contradicts", "example"]),
});
export type ProvenanceItem = z.infer<typeof provenanceItemSchema>;

export const reportClaimSchema = z.object({
  claim_id: z.string().min(1),
  text: z.string().min(1),
  confidence_label: z.enum(["exploratory", "supported", "contradicted"]),
  evidence: z.array(provenanceItemSchema),
  method: z.enum([
    "llm_generated_synthesis",
    "source_backed_extraction",
    "aggregate_simulation",
    "surrogate_inferred",
  ]),
});
export type ReportClaim = z.infer<typeof reportClaimSchema>;
