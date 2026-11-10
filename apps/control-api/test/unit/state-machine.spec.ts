/**
 * Run state machine: legal transitions per the durable runner contract,
 * with illegal transitions rejected (worker-facing assertLegalTransition).
 */
import { describe, expect, it } from "vitest";
import { assertLegalTransition } from "@crowdlens/contracts";

const LEGAL: [string, string][] = [
  ["queued", "preparing"],
  ["queued", "cancelled"],
  ["preparing", "running"],
  ["preparing", "cancelled"],
  ["running", "paused"],
  ["running", "finalizing"],
  ["running", "cancelled"],
  ["paused", "running"],
  ["paused", "cancelled"],
  ["finalizing", "completed"],
  ["finalizing", "failed"],
];

describe("assertLegalTransition", () => {
  it("accepts every legal transition", () => {
    for (const [from, to] of LEGAL) {
      expect(() => assertLegalTransition(from as never, to as never)).not.toThrow();
    }
  });

  it("rejects backwards transitions", () => {
    for (const [, to] of LEGAL) {
      expect(() => assertLegalTransition(to as never, "queued" as never)).toThrow();
    }
  });

  it("rejects terminal-state escapes", () => {
    expect(() => assertLegalTransition("completed" as never, "running" as never)).toThrow();
    expect(() => assertLegalTransition("failed" as never, "queued" as never)).toThrow();
    expect(() => assertLegalTransition("cancelled" as never, "running" as never)).toThrow();
  });
});
