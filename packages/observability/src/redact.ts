/**
 * Shared redaction. Never log document bodies, prompts, raw payment payloads,
 * or secrets (instructions.md §3.1, §14.2). Field-name based with value
 * heuristics for key-like strings.
 */

const SENSITIVE_FIELD = new RegExp(
  [
    "secret",
    "token",
    "password",
    "api[_-]?key",
    "authorization",
    "cookie",
    "session",
    "private[_-]?key",
    "webhook",
    "signature",
    "prompt",
    "document",
    "source_text",
    "content",
    "body",
  ].join("|"),
  "i",
);

const VALUE_KEY_LIKE =
  /^(sk-(live|test)-[A-Za-z0-9_-]{8,}|rk_(live|test)_[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9_-]{6,}|xox[baprs]-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})$/;

export const REDACTED = "[redacted]";

export function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return VALUE_KEY_LIKE.test(value) ? REDACTED : value.length > 512 ? `${value.slice(0, 512)}…` : value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(nested);
    }
    return out;
  }
  return value;
}
