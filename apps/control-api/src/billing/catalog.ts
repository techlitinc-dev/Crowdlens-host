/**
 * Server-managed plan catalog, credit packs, and versioned rate card
 * (specs.md §9, OPS-04: pricing is configuration, not code constants).
 * Versions are pinned at process start; historical usage stays explainable
 * because every ledger entry and simulation records its rate_card_version.
 */

export interface PlanDef {
  code: string;
  name: string;
  priceMinor: number;
  currency: "INR";
  interval: "month";
  includedCredits: number;
  agentCeiling: number;
  seats: number;
  maxConcurrentRuns: number;
  maxActiveProjects: number;
  maxDocumentMb: number;
  maxDocumentsPerProject: number;
  priorityQueue: boolean;
}

export interface CreditPackDef {
  code: string;
  credits: number;
  priceMinor: number;
  currency: "INR";
}

export const PLANS: PlanDef[] = [
  {
    code: "explorer",
    name: "Explorer",
    priceMinor: 0,
    currency: "INR",
    interval: "month",
    includedCredits: 300,
    agentCeiling: 10_000,
    seats: 1,
    maxConcurrentRuns: 1,
    maxActiveProjects: 1,
    maxDocumentMb: 5,
    maxDocumentsPerProject: 3,
    priorityQueue: false,
  },
  {
    code: "professional",
    name: "Professional",
    priceMinor: 499_900,
    currency: "INR",
    interval: "month",
    includedCredits: 2_500,
    agentCeiling: 100_000,
    seats: 3,
    maxConcurrentRuns: 2,
    maxActiveProjects: 10,
    maxDocumentMb: 20,
    maxDocumentsPerProject: 20,
    priorityQueue: false,
  },
  {
    code: "business",
    name: "Business",
    priceMinor: 1_999_900,
    currency: "INR",
    interval: "month",
    includedCredits: 12_000,
    agentCeiling: 1_000_000,
    seats: 10,
    maxConcurrentRuns: 5,
    maxActiveProjects: 100,
    maxDocumentMb: 50,
    maxDocumentsPerProject: 100,
    priorityQueue: true,
  },
];

export const CREDIT_PACKS: CreditPackDef[] = [
  { code: "pack-500", credits: 500, priceMinor: 99_900, currency: "INR" },
  { code: "pack-2000", credits: 2_000, priceMinor: 349_900, currency: "INR" },
  { code: "pack-10000", credits: 10_000, priceMinor: 1_499_900, currency: "INR" },
];

export function planByCode(code: string): PlanDef | undefined {
  return PLANS.find((plan) => plan.code === code);
}

export function packByCode(code: string): CreditPackDef | undefined {
  return CREDIT_PACKS.find((pack) => pack.code === code);
}

/** Usage rating per rate-card version (integer credits). */
export interface RateCard {
  version: string;
  /** Credits per 1,000 agent-ticks (surrogate/cohort propagation). */
  populationTickPerThousand: number;
  /** Credits per active-reasoning LLM call. */
  activeReasoningCall: number;
  /** Credits per parsed chunk (graph extraction). */
  graphChunk: number;
  /** Credits per report section generated. */
  reportSection: number;
  /** Multiplier applied by provider route. */
  providerMultiplier: Record<string, number>;
}

export const RATE_CARD: RateCard = {
  version: "credits-2026-11-09",
  populationTickPerThousand: 1,
  activeReasoningCall: 4,
  graphChunk: 2,
  reportSection: 3,
  providerMultiplier: { gemini: 1, openrouter: 11, mock: 1 },
};

export function rateFor(card: RateCard, usageType: string, units: number, provider: string): number {
  const providerFactor = card.providerMultiplier[provider] ?? 10;
  switch (usageType) {
    case "population_tick":
      return Math.ceil((units / 1000) * card.populationTickPerThousand * providerFactor);
    case "active_reasoning":
      return units * card.activeReasoningCall * providerFactor;
    case "graph_chunk":
      return units * card.graphChunk;
    case "report_section":
      return units * card.reportSection;
    default:
      return Math.ceil(units * providerFactor);
  }
}

/** Rates a run's durable usage records into total credits to settle. */
export function settleCreditsFor(
  card: RateCard,
  usage: { usage_type: string; units: number; provider: string }[],
): number {
  return usage.reduce(
    (total, row) => total + rateFor(card, row.usage_type, row.units, row.provider),
    0,
  );
}

/** Pre-purchase credit estimator (shown before confirmation, specs §5.1 step 7). */
export function estimateCredits(input: {
  population: number;
  activeBudget: number;
  ticks: number;
  reportDepth: "standard" | "detailed";
  provider: string;
  documentPages?: number;
}): { low: number; high: number; drivers: { factor: string; credits: number }[] } {
  const providerFactor = RATE_CARD.providerMultiplier[input.provider] ?? 10;
  const prep = Math.ceil(input.population / 5000) * providerFactor;
  // Active reasoning is billed per structured CALL; the kernel batches
  // ACTION_BATCH (8) agents per call — the estimate must mirror that.
  const perTick =
    Math.ceil(input.activeBudget / 8) * RATE_CARD.activeReasoningCall * providerFactor +
    Math.ceil(input.population / 50_000) * RATE_CARD.populationTickPerThousand;
  const ticks = perTick * input.ticks;
  const pages = Math.max(1, Math.ceil((input.documentPages ?? 5) / 5));
  const graph = pages * 5 * RATE_CARD.graphChunk;
  const report = (input.reportDepth === "detailed" ? 20 : 8) * RATE_CARD.reportSection;
  const base = prep + ticks + graph + report;
  const drivers = [
    { factor: "population preparation", credits: prep },
    { factor: `${input.ticks} ticks (active reasoning + cohort propagation)`, credits: ticks },
    { factor: "source graph extraction", credits: graph },
    { factor: `report generation (${input.reportDepth})`, credits: report },
  ];
  return { low: Math.ceil(base * 0.8), high: Math.ceil(base * 1.4), drivers };
}
