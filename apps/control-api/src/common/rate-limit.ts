import { problems } from "./problem-details.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/** Minimal in-memory fixed-window limiter for expensive endpoints. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) this.buckets.clear(); // bounded housekeeping
    if (bucket.count > this.limit) throw problems.tooManyRequests("Rate limit exceeded");
  }
}
