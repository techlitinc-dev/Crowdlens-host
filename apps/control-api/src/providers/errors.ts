export type ProviderErrorCode =
  | "rate_limit"
  | "server_error"
  | "timeout"
  | "invalid_response"
  | "schema_mismatch"
  | "quota_exhausted"
  | "auth"
  | "data_policy_unavailable"
  | "network";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly provider: string,
    message: string,
    public readonly retryable: boolean,
    public readonly statusHint?: number,
  ) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = "ProviderError";
  }
}

/** Retry budget: exponential backoff with jitter, max elapsed time. */
export function computeBackoffMs(attempt: number, baseMs = 500, maxMs = 8000): number {
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.random() * exponential * 0.5;
  return Math.floor(exponential / 2 + jitter);
}

export const MAX_PROVIDER_ELAPSED_MS = 45_000;
