/**
 * Canonical JSON serialisation + semantic fingerprinting.
 *
 * Algorithm (mirrored exactly in Python at
 * packages/contracts/python/crowdlens_contracts/canonical_json.py; golden
 * vectors in test/fixtures/golden-fingerprints.json):
 *
 *  - Objects: keys sorted by UTF-16 code units, no whitespace.
 *  - Strings: JSON-escaped, non-ASCII preserved (ensure_ascii=False).
 *  - Numbers: integers plain; floats use shortest round-trip decimal
 *    (fingerprint inputs MUST avoid floats — see architecture.md §12.2).
 *  - fingerprint = lowercase hex SHA-256 of the canonical UTF-8 bytes.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function escapeString(value: string): string {
  // JSON.stringify matches the required escaping exactly: control characters,
  // quotes and backslashes escaped; non-ASCII passed through.
  return JSON.stringify(value);
}

function compareUtf16(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return escapeString(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("canonicalJson: non-finite numbers are not canonicalisable");
      }
      if (!Number.isInteger(value)) {
        throw new Error(
          "canonicalJson: floats are not allowed in fingerprint inputs (architecture.md §12.2)",
        );
      }
      return String(value);
    }
    case "boolean":
      return value ? "true" : "false";
    default: {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const keys = Object.keys(value).sort(compareUtf16);
      const parts = keys.map(
        (key) => `${escapeString(key)}:${canonicalJson((value as Record<string, CanonicalValue>)[key] as CanonicalValue)}`,
      );
      return `{${parts.join(",")}}`;
    }
  }
}

/** SHA-256 hex digest of the canonical serialisation of `value`. */
export async function fingerprint(value: CanonicalValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

/** Synchronous fingerprint for Node runtimes. */
export function fingerprintSync(value: CanonicalValue): string {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const nodeCrypto = (
    proc?.getBuiltinModule?.("node:crypto") ??
    // CJS runtimes without getBuiltinModule (older Node under vitest CJS).
    (typeof (globalThis as { require?: unknown }).require === "function"
      ? (globalThis as { require: (id: string) => unknown }).require("node:crypto")
      : null)
  ) as typeof import("node:crypto") | null;
  if (!nodeCrypto) {
    throw new Error(
      "fingerprintSync: Node crypto is unavailable in this runtime; use the async fingerprint() (WebCrypto) instead",
    );
  }
  return nodeCrypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
