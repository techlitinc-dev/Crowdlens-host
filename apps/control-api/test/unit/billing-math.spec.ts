/**
 * Pure billing math: the pre-purchase estimator must mirror the rate card
 * (specs.md §5.1 step 7) and the settlement rating must be explainable per
 * entry (every ledger entry records its rate_card_version).
 */
import { describe, expect, it } from "vitest";
import { estimateCredits, rateFor, RATE_CARD, settleCreditsFor } from "../../src/billing/catalog.js";

describe("estimateCredits", () => {
  it("produces a bracketed band with the high bound above the low bound", () => {
    const result = estimateCredits({
      population: 1000,
      activeBudget: 64,
      ticks: 4,
      reportDepth: "standard",
      provider: "mock",
    });
    expect(result.low).toBeGreaterThan(0);
    expect(result.high).toBeGreaterThan(result.low);
    expect(result.drivers.length).toBe(4);
  });

  it("mirrors the ACTION_BATCH (8) call batching in the active-reasoning driver", () => {
    // 8 agents → 1 call; 9 agents → 2 calls. The estimate must step at the
    // batch boundary exactly like the kernel bills.
    const oneCall = estimateCredits({ population: 1000, activeBudget: 8, ticks: 1, reportDepth: "standard", provider: "mock" });
    const twoCalls = estimateCredits({ population: 1000, activeBudget: 9, ticks: 1, reportDepth: "standard", provider: "mock" });
    const perCall = RATE_CARD.activeReasoningCall; // mock multiplier = 1
    const diff = twoCalls.drivers.find((d) => d.factor.includes("ticks"))!.credits - oneCall.drivers.find((d) => d.factor.includes("ticks"))!.credits;
    expect(diff).toBe(perCall);
  });

  it("scales with provider multiplier", () => {
    const mock = estimateCredits({ population: 10000, activeBudget: 64, ticks: 4, reportDepth: "standard", provider: "mock" });
    const openrouter = estimateCredits({ population: 10000, activeBudget: 64, ticks: 4, reportDepth: "standard", provider: "openrouter" });
    expect(openrouter.high).toBeGreaterThan(mock.high * 5);
  });
});

describe("settlement rating (rateFor / settleCreditsFor)", () => {
  it("rates active reasoning per call with the provider multiplier", () => {
    expect(rateFor(RATE_CARD, "active_reasoning", 10, "mock")).toBe(10 * RATE_CARD.activeReasoningCall);
    expect(rateFor(RATE_CARD, "active_reasoning", 10, "openrouter")).toBe(10 * RATE_CARD.activeReasoningCall * 11);
  });

  it("rates population ticks per thousand input tokens", () => {
    expect(rateFor(RATE_CARD, "population_tick", 5000, "mock")).toBe(5 * RATE_CARD.populationTickPerThousand);
  });

  it("settles a mixed usage bundle deterministically", () => {
    const usage = [
      { usage_type: "active_reasoning", units: 12, provider: "mock" },
      { usage_type: "population_tick", units: 9000, provider: "mock" },
      { usage_type: "graph_chunk", units: 3, provider: "mock" },
    ];
    const total = settleCreditsFor(RATE_CARD, usage);
    expect(total).toBe(
      12 * RATE_CARD.activeReasoningCall +
        Math.ceil(9 * RATE_CARD.populationTickPerThousand) +
        3 * RATE_CARD.graphChunk,
    );
  });
});
