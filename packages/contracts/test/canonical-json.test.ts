import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalJson, fingerprintSync } from "../src/canonical-json.js";

interface Vector {
  name: string;
  input: unknown;
  canonical: string;
  fingerprint: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "golden-fingerprints.json"), "utf8"),
) as { vectors: Vector[] };

describe("canonical JSON parity with Python mirror", () => {
  for (const vector of fixture.vectors) {
    it(`vector: ${vector.name}`, () => {
      expect(canonicalJson(vector.input as never)).toBe(vector.canonical);
      expect(fingerprintSync(vector.input as never)).toBe(vector.fingerprint);
    });
  }

  it("rejects floats in fingerprint inputs", () => {
    expect(() => canonicalJson({ bad: 1.5 } as never)).toThrow(/floats/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson(Number.NaN as never)).toThrow(/non-finite/);
  });

  it("sorts keys by UTF-16 code units (JS native order)", () => {
    expect(canonicalJson({ z: 1, aa: 2, a: 3, Z: 4 } as never)).toBe(
      '{"Z":4,"a":3,"aa":2,"z":1}',
    );
  });
});
