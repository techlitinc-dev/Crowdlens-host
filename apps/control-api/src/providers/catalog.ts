/**
 * Server-managed model catalog (OPS-03): providers and models are allowlisted
 * configuration, never browser strings. Model capabilities/prices must be
 * revalidated before changing (specs.md §18).
 */
export interface CatalogModel {
  id: string;
  provider: "gemini" | "openrouter";
  label: string;
  structuredOutput: boolean;
  contextWindow: number;
  /** Micro-USD per 1K input / output tokens (illustrative, revalidate). */
  costPer1kInputMicroUsd: number;
  costPer1kOutputMicroUsd: number;
  dataPolicy: { zdrSupported: boolean; notes: string };
}

export interface ProviderDescriptor {
  id: "gemini" | "openrouter";
  label: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG_VERSION = "models-2026-11-09";

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  {
    id: "gemini",
    label: "Gemini (AI Studio key)",
    models: [
      {
        id: "gemini-2.5-flash",
        provider: "gemini",
        label: "Gemini 2.5 Flash",
        structuredOutput: true,
        contextWindow: 1_048_576,
        costPer1kInputMicroUsd: 30,
        costPer1kOutputMicroUsd: 250,
        dataPolicy: { zdrSupported: false, notes: "Google API data-governance terms apply" },
      },
      {
        id: "gemini-2.5-pro",
        provider: "gemini",
        label: "Gemini 2.5 Pro",
        structuredOutput: true,
        contextWindow: 1_048_576,
        costPer1kInputMicroUsd: 1250,
        costPer1kOutputMicroUsd: 10_000,
        dataPolicy: { zdrSupported: false, notes: "Google API data-governance terms apply" },
      },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    models: [
      {
        id: "openrouter/gpt-4o-mini",
        provider: "openrouter",
        label: "GPT-4o mini (via OpenRouter)",
        structuredOutput: true,
        contextWindow: 128_000,
        costPer1kInputMicroUsd: 15,
        costPer1kOutputMicroUsd: 60,
        dataPolicy: { zdrSupported: true, notes: "ZDR where the upstream endpoint supports it" },
      },
      {
        id: "openrouter/claude-3.5-sonnet",
        provider: "openrouter",
        label: "Claude 3.5 Sonnet (via OpenRouter)",
        structuredOutput: true,
        contextWindow: 200_000,
        costPer1kInputMicroUsd: 3000,
        costPer1kOutputMicroUsd: 15_000,
        dataPolicy: { zdrSupported: true, notes: "ZDR where the upstream endpoint supports it" },
      },
    ],
  },
];

export function catalogModel(provider: string, modelId: string): CatalogModel | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === provider)?.models.find((m) => m.id === modelId);
}

export const MOCK_MODEL_ID = "mock-sim-1";
