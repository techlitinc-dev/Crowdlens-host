import { describe, expect, it } from "vitest";
import { redactValue, REDACTED } from "../src/redact.js";
import { createLogger } from "../src/logger.js";

describe("redactValue", () => {
  it("redacts sensitive field names at any depth", () => {
    const out = redactValue({
      client_secret: "abc",
      nested: { api_key: "xyz", safe: 1 },
      authorization: "Bearer token",
    }) as Record<string, unknown>;
    expect(out.client_secret).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).api_key).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).safe).toBe(1);
  });

  it("redacts key-like string values", () => {
    expect(redactValue("sk-live-abcdef1234567890")).toBe(REDACTED);
    expect(redactValue("whsec_abc123")).toBe(REDACTED);
  });

  it("truncates long strings (no document bodies in logs)", () => {
    const long = "a".repeat(2000);
    const out = redactValue(long) as string;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(600);
  });
});

describe("createLogger", () => {
  it("emits redacted JSON with correlation ids", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      sink: (line) => lines.push(line),
      context: { request_id: "req-1" },
    });
    logger.info("hello", { token: "should-redact" });
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record.msg).toBe("hello");
    expect(record.request_id).toBe("req-1");
    expect(record.token).toBe(REDACTED);
    expect(record.service).toBe("test");
  });
});
