import { Inject, Injectable, Logger } from "@nestjs/common";
import Ajv, { type ValidateFunction } from "ajv";
import type {
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TokenUsage,
} from "@crowdlens/contracts";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { catalogModel } from "./catalog.js";
import {
  MAX_PROVIDER_ELAPSED_MS,
  ProviderError,
  computeBackoffMs,
} from "./errors.js";

export interface ProviderCallContext {
  workspaceId: string;
  runId?: string;
  activityAttempt?: string;
  /** Exact-safe cache (architecture.md §12.7) — only for eligible operations. */
  cache?: { get: (key: string) => Promise<unknown | null>; set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>; fingerprint: string; ttlSeconds: number };
}

export interface ResolvedProviderConfig {
  provider: "gemini" | "openrouter" | "mock";
  modelId: string;
  apiKey: string;
  dataPolicy: { data_collection: "allow" | "deny"; zdr: boolean };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

/**
 * Provider gateway (architecture.md §10). Structured generation always:
 * JSON Schema in → local Ajv validation of parsed output → normalised result
 * with token/cost evidence. Provider cache hits are cost optimisations only.
 */
@Injectable()
export class ProviderGateway {
  private readonly logger = new Logger("provider-gateway");
  private readonly ajv = new Ajv({ strict: false, allErrors: true });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  private validatorFor(schema: Record<string, unknown>, schemaVersion: string): ValidateFunction {
    const key = `${schemaVersion}:${JSON.stringify(schema)}`;
    let validator = this.validators.get(key);
    if (!validator) {
      validator = this.ajv.compile(schema);
      if (this.validators.size > 500) this.validators.clear();
      this.validators.set(key, validator);
    }
    return validator;
  }

  async generateStructured(
    request: StructuredGenerationRequest,
    ctx: ProviderCallContext,
  ): Promise<StructuredGenerationResult> {
    if (request.provider !== "mock" && !catalogModel(request.provider, request.model_id)) {
      throw new ProviderError("data_policy_unavailable", request.provider, "model not in server catalog", false);
    }

    // Cache consult AFTER tenant validation (guard ran upstream); exact-safe only.
    if (ctx.cache) {
      const cached = await ctx.cache.get(ctx.cache.fingerprint);
      if (cached !== null && cached !== undefined) {
        const hit = cached as StructuredGenerationResult;
        return {
          ...hit,
          cache_metadata: { ...(hit.cache_metadata ?? {}), hit: true, fingerprint: ctx.cache.fingerprint },
        };
      }
    }

    const started = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (Date.now() - started > MAX_PROVIDER_ELAPSED_MS) {
        throw new ProviderError("timeout", request.provider, "provider call exceeded elapsed budget", false);
      }
      try {
        const result = await this.dispatch(request, ctx, attempt);
        const validator = this.validatorFor(request.json_schema, request.schema_version);
        if (!validator(result.data)) {
          throw new ProviderError(
            "schema_mismatch",
            request.provider,
            `response failed schema validation: ${this.ajv.errorsText(validator.errors)}`,
            false,
          );
        }
        if (ctx.cache) {
          await ctx.cache.set(ctx.cache.fingerprint, result, ctx.cache.ttlSeconds).catch(() => undefined);
        }
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof ProviderError && !error.retryable) throw error;
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(computeBackoffMs(attempt));
        }
      }
    }
    throw lastError instanceof ProviderError
      ? lastError
      : new ProviderError("network", request.provider, String(lastError), false);
  }

  private async dispatch(
    request: StructuredGenerationRequest,
    ctx: ProviderCallContext,
    attempt: number,
  ): Promise<StructuredGenerationResult> {
    switch (request.provider) {
      case "mock":
        return this.mockGenerate(request, attempt);
      case "gemini":
        return this.geminiGenerate(request, ctx, attempt);
      case "openrouter":
        return this.openrouterGenerate(request, ctx, attempt);
    }
  }

  // ---------- Mock provider: deterministic, labelled, zero-cost ----------

  private async mockGenerate(
    request: StructuredGenerationRequest,
    attempt: number,
  ): Promise<StructuredGenerationResult> {
    const seed = hashCode(request.prompt_prefix + request.prompt_suffix);
    const data = synthesizeFromSchema(request.json_schema, seed);
    const inputTokens = Math.ceil((request.prompt_prefix.length + request.prompt_suffix.length) / 4);
    const outputTokens = Math.ceil(JSON.stringify(data).length / 4);
    await sleep(5 + (seed % 20));
    return {
      data,
      provider: "mock",
      model_id: request.model_id,
      endpoint: "local-mock",
      request_id: `mock-${seed.toString(16)}-${attempt}`,
      latency_ms: 0,
      retries: attempt,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_input_tokens: 0,
        cost_estimate_micro_usd: inputTokens * 30 + outputTokens * 250,
        usage_is_estimate: true,
      },
    };
  }

  // ---------- Gemini Developer API (official @google/genai SDK) ----------

  private async geminiGenerate(
    request: StructuredGenerationRequest,
    ctx: ProviderCallContext,
    attempt: number,
  ): Promise<StructuredGenerationResult> {
    const apiKey = this.config.GEMINI_API_KEY_REFERENCE;
    if (!apiKey) throw new ProviderError("auth", "gemini", "Gemini API key not configured", false);
    const { GoogleGenAI, Type } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const started = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: request.model_id,
        contents: `${request.prompt_prefix}\n\n${request.prompt_suffix}`,
        config: {
          responseMimeType: "application/json",
          ...(request.json_schema ? { responseSchema: toGeminiSchema(request.json_schema, Type) } : {}),
          temperature: request.temperature,
          maxOutputTokens: request.max_output_tokens,
        },
      });
      const text = response.text ?? "";
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ProviderError("invalid_response", "gemini", "response was not valid JSON", false);
      }
      const usageMeta = response.usageMetadata ?? {};
      const promptTokens = usageMeta.promptTokenCount ?? 0;
      const outputTokens = usageMeta.candidatesTokenCount ?? 0;
      const cachedTokens = usageMeta.cachedContentTokenCount ?? 0;
      const model = catalogModel("gemini", request.model_id);
      return {
        data,
        provider: "gemini",
        model_id: request.model_id,
        endpoint: "generativelanguage.googleapis.com",
        request_id: String((response as unknown as Record<string, unknown>)["responseId"] ?? ""),
        latency_ms: Date.now() - started,
        retries: attempt,
        usage: {
          input_tokens: promptTokens,
          output_tokens: outputTokens,
          cached_input_tokens: cachedTokens,
          cost_estimate_micro_usd: model
            ? Math.ceil(((promptTokens - cachedTokens) / 1000) * model.costPer1kInputMicroUsd + (outputTokens / 1000) * model.costPer1kOutputMicroUsd)
            : undefined,
          usage_is_estimate: false,
        },
        cache_metadata: cachedTokens > 0 ? { provider_cache_hit_tokens: cachedTokens } : undefined,
      };
    } catch (error) {
      throw mapGeminiError(error, attempt);
    }
  }

  // ---------- OpenRouter (OpenAI-compatible supported contract) ----------

  private async openrouterGenerate(
    request: StructuredGenerationRequest,
    ctx: ProviderCallContext,
    attempt: number,
  ): Promise<StructuredGenerationResult> {
    const apiKey = this.config.OPENROUTER_API_KEY_REFERENCE;
    if (!apiKey) throw new ProviderError("auth", "openrouter", "OpenRouter API key not configured", false);
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      defaultHeaders: {
        "HTTP-Referer": this.config.OPENROUTER_APP_URL,
        "X-Title": this.config.OPENROUTER_APP_NAME,
      },
      timeout: DEFAULT_TIMEOUT_MS,
      maxRetries: 0,
    });
    const started = Date.now();
    const upstream = request.model_id.replace(/^openrouter\//, "");
    try {
      const completion = await client.chat.completions.create(
        {
          model: upstream,
          messages: [
            { role: "system", content: request.prompt_prefix },
            { role: "user", content: request.prompt_suffix },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "crowdlens_structured_output",
              strict: true,
              schema: request.json_schema as Record<string, unknown>,
            },
          },
          temperature: request.temperature,
          max_tokens: request.max_output_tokens,
          ...((request.session_id ?? ctx.runId)
            ? { user: `cl-${request.session_id ?? ctx.runId}` }
            : {}),
        },
        {
          body: {
            provider: {
              require_parameters: true,
              ...(request.data_policy?.data_collection === "deny" ? { data_collection: "deny" } : {}),
              ...(request.data_policy?.zdr ? { zdr: true } : {}),
            },
            ...(request.session_id ? { session_id: request.session_id } : {}),
          },
        } as never,
      );
      const text = completion.choices[0]?.message?.content ?? "";
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ProviderError("invalid_response", "openrouter", "response was not valid JSON", false);
      }
      const usage = completion.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;
      // OpenRouter may report prompt cache hits on the completion object.
      const cacheHit = (usage as unknown as Record<string, number> | undefined)?.["prompt_cache_hit_tokens"] ?? 0;
      const model = catalogModel("openrouter", request.model_id);
      return {
        data,
        provider: "openrouter",
        model_id: request.model_id,
        endpoint: completion.model,
        request_id: completion.id,
        latency_ms: Date.now() - started,
        retries: attempt,
        usage: {
          input_tokens: promptTokens,
          output_tokens: outputTokens,
          cached_input_tokens: cacheHit,
          cost_estimate_micro_usd: model
            ? Math.ceil(((promptTokens - cacheHit) / 1000) * model.costPer1kInputMicroUsd + (outputTokens / 1000) * model.costPer1kOutputMicroUsd)
            : undefined,
          usage_is_estimate: !usage,
        },
        cache_metadata: cacheHit > 0 ? { provider_cache_hit_tokens: cacheHit } : undefined,
      };
    } catch (error) {
      throw mapOpenRouterError(error, attempt);
    }
  }

  async healthCheck(config: ResolvedProviderConfig): Promise<{ ok: boolean; detail: string }> {
    try {
      if (config.provider === "mock") return { ok: true, detail: "local deterministic provider" };
      if (config.provider === "openrouter") {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: config.apiKey, timeout: 10_000 });
        await client.models.list();
        return { ok: true, detail: "OpenRouter API reachable" };
      }
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      await ai.models.generateContent({
        model: config.modelId,
        contents: "ping",
        config: { maxOutputTokens: 8 },
      });
      return { ok: true, detail: "Gemini API reachable" };
    } catch (error) {
      return { ok: false, detail: (error as Error).message.slice(0, 300) };
    }
  }
}

// ---------- helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic schema-shaped synthesis for the mock provider. */
export function synthesizeFromSchema(schema: Record<string, unknown>, seed: number): unknown {
  const rng = mulberry32(seed);
  const resolve = (s: Record<string, unknown>): unknown => {
    if (s["const"] !== undefined) return s["const"];
    const type = s["type"];
    if (s["enum"] && Array.isArray(s["enum"])) {
      return s["enum"][Math.floor(rng() * (s["enum"] as unknown[]).length)];
    }
    switch (type) {
      case "string":
        if (s["format"] === "date-time") return new Date(1_700_000_000_000 + Math.floor(rng() * 100_000_000_000)).toISOString();
        return `mock-${Math.floor(rng() * 1e6).toString(36)}`;
      case "integer":
        return Math.floor(rng() * 100);
      case "number":
        return Math.round(rng() * 1000) / 10;
      case "boolean":
        return rng() > 0.5;
      case "array": {
        const count = Math.max(1, Math.floor(rng() * 3));
        const itemSchema = (s["items"] as Record<string, unknown>) ?? { type: "string" };
        return Array.from({ length: count }, () => resolve(itemSchema));
      }
      case "object":
      default: {
        const props = (s["properties"] as Record<string, unknown>) ?? {};
        const required = new Set((s["required"] as string[]) ?? Object.keys(props));
        const out: Record<string, unknown> = {};
        for (const [key, sub] of Object.entries(props)) {
          if (required.has(key)) out[key] = resolve(sub as Record<string, unknown>);
        }
        return out;
      }
    }
  };
  return resolve(schema);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toGeminiSchema(schema: Record<string, unknown>, Type: Record<string, unknown>): unknown {
  // The SDK accepts plain JSON Schema for responseSchema; pass through with a
  // nominal conversion entry point so we control the shape per SDK version.
  void Type;
  return schema;
}

function mapGeminiError(error: unknown, attempt: number): ProviderError {
  const err = error as { status?: number; message?: string; code?: number };
  const status = err?.status ?? err?.code ?? 0;
  const message = err?.message ?? String(error);
  if (status === 429) return new ProviderError("rate_limit", "gemini", message, true, 429);
  if (status === 401 || status === 403) return new ProviderError("auth", "gemini", message, false, status);
  if (status === 400 && /quota|billing/i.test(message)) return new ProviderError("quota_exhausted", "gemini", message, false, status);
  if (typeof status === "number" && status >= 500) return new ProviderError("server_error", "gemini", message, true, status);
  if (/timeout|deadline|aborted/i.test(message)) return new ProviderError("timeout", "gemini", message, true);
  return new ProviderError("network", "gemini", message, attempt < 3);
}

function mapOpenRouterError(error: unknown, attempt: number): ProviderError {
  const err = error as { status?: number; message?: string; code?: string };
  const status = err?.status ?? 0;
  const message = err?.message ?? String(error);
  if (status === 429) return new ProviderError("rate_limit", "openrouter", message, true, 429);
  if (status === 401 || status === 403) return new ProviderError("auth", "openrouter", message, false, status);
  if (status === 402) return new ProviderError("quota_exhausted", "openrouter", message, false, status);
  if (typeof status === "number" && status >= 500) return new ProviderError("server_error", "openrouter", message, true, status);
  if (err?.code === "ETIMEDOUT" || /timeout/i.test(message)) return new ProviderError("timeout", "openrouter", message, true);
  return new ProviderError("network", "openrouter", message, attempt < 3);
}
