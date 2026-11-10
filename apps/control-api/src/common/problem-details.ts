import { HttpStatus } from "@nestjs/common";

/**
 * Shared problem-details error format (architecture.md §7.1).
 */
export class ProblemDetailsError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly title: string,
    public readonly detail: string,
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = "ProblemDetailsError";
  }

  toBody(): Record<string, unknown> {
    return {
      type: `https://crowdlens.dev/problems/${this.type}`,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...this.extensions,
    };
  }
}

export const problems = {
  unauthenticated: (detail = "Authentication required") =>
    new ProblemDetailsError(HttpStatus.UNAUTHORIZED, "unauthenticated", "Unauthenticated", detail),
  forbidden: (detail = "You do not have access to this resource") =>
    new ProblemDetailsError(HttpStatus.FORBIDDEN, "forbidden", "Forbidden", detail),
  notFound: (what = "resource") =>
    new ProblemDetailsError(HttpStatus.NOT_FOUND, "not-found", "Not found", `${what} not found`),
  conflict: (detail: string, extensions: Record<string, unknown> = {}) =>
    new ProblemDetailsError(HttpStatus.CONFLICT, "conflict", "Conflict", detail, extensions),
  validation: (detail: string, errors: unknown) =>
    new ProblemDetailsError(HttpStatus.UNPROCESSABLE_ENTITY, "validation", "Validation failed", detail, { errors }),
  unprocessable: (detail: string) =>
    new ProblemDetailsError(HttpStatus.UNPROCESSABLE_ENTITY, "unprocessable", "Unprocessable", detail),
  tooManyRequests: (detail: string) =>
    new ProblemDetailsError(HttpStatus.TOO_MANY_REQUESTS, "rate-limited", "Rate limited", detail),
  internal: (detail = "Internal error") =>
    new ProblemDetailsError(HttpStatus.INTERNAL_SERVER_ERROR, "internal", "Internal error", detail),
  insufficientCredits: (detail: string, extensions: Record<string, unknown> = {}) =>
    new ProblemDetailsError(HttpStatus.CONFLICT, "insufficient-credits", "Insufficient credits", detail, extensions),
  providerUnavailable: (detail: string) =>
    new ProblemDetailsError(HttpStatus.SERVICE_UNAVAILABLE, "provider-unavailable", "Provider unavailable", detail),
  billingNotConfigured: () =>
    new ProblemDetailsError(
      HttpStatus.SERVICE_UNAVAILABLE,
      "billing-not-configured",
      "Billing not configured",
      "Payment provider is not configured for this environment",
    ),
};
