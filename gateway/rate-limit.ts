/**
 * Rate limiting — in-memory primary with optional KV-backed distributed counter.
 *
 * KV strategy: fixed-window per-minute. Each IP gets a key:
 *   gateway:ratelimit:{ip}:{minute} → count (TTL 120s)
 *
 * When KV is enabled, both in-memory AND KV are checked. In-memory protects
 * against stampedes within a single process; KV enforces the limit across
 * multiple Render instances.
 */

import { kvEnabled, kvGet, kvSet } from "./kv.js";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(clientKey: string, now = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(clientKey) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterMs = oldest + this.windowMs - now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    timestamps.push(now);
    this.hits.set(clientKey, timestamps);
    return { allowed: true };
  }
}

/**
 * KV-backed fixed-window counter. Falls back silently when KV is unavailable.
 * Returns false if the counter was incremented and the limit was NOT exceeded,
 * true if the limit IS exceeded.
 */
export async function kvRateLimitExceeded(
  clientKey: string,
  maxRequests: number,
): Promise<boolean> {
  if (!kvEnabled()) return false;
  const minute = Math.floor(Date.now() / 60_000);
  const key = `gateway:ratelimit:${clientKey}:${minute}`;
  try {
    const current = (await kvGet<number>(key)) ?? 0;
    if (current >= maxRequests) return true;
    // TTL 120s covers the current minute and next minute rollover
    await kvSet(key, current + 1, 120);
    return false;
  } catch {
    // Non-fatal — fall through to in-memory limiter
    return false;
  }
}

export function clientIp(req: { headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]?.trim() || "unknown";
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp;
  return "unknown";
}

