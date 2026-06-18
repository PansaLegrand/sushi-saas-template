import { respJson } from "@/lib/resp";
import { ApiResponseCode } from "@/types/api";

type RateLimitBucket = "auth" | "checkout" | "feedback" | "credits" | "uploads" | "tasks";

type RateLimitRule = {
  limit: number;
  windowMs: number;
};

type RateLimitState = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_RULES: Record<RateLimitBucket, RateLimitRule> = {
  auth: { limit: 20, windowMs: 60 * 1000 },
  checkout: { limit: 10, windowMs: 60 * 1000 },
  feedback: { limit: 5, windowMs: 60 * 1000 },
  credits: { limit: 30, windowMs: 60 * 1000 },
  uploads: { limit: 20, windowMs: 60 * 1000 },
  tasks: { limit: 10, windowMs: 60 * 1000 },
};

const buckets = new Map<string, RateLimitState>();

function getRequestIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function getBucketKey(req: Request, bucket: RateLimitBucket, key?: string): string {
  return `${bucket}:${key ?? getRequestIp(req)}`;
}

function cleanupExpired(now: number) {
  if (buckets.size < 1000) {
    return;
  }

  for (const [key, state] of buckets) {
    if (state.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  req: Request,
  bucket: RateLimitBucket,
  options: { key?: string } = {}
):
  | {
      allowed: true;
      headers: Headers;
    }
  | {
      allowed: false;
      response: Response;
    } {
  const rule = RATE_LIMIT_RULES[bucket];
  const now = Date.now();
  cleanupExpired(now);

  const key = getBucketKey(req, bucket, options.key);
  const existing = buckets.get(key);
  const state =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + rule.windowMs };

  state.count += 1;
  buckets.set(key, state);

  const remaining = Math.max(0, rule.limit - state.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  const headers = new Headers({
    "RateLimit-Limit": String(rule.limit),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(Math.ceil(state.resetAt / 1000)),
  });

  if (state.count <= rule.limit) {
    return { allowed: true, headers };
  }

  headers.set("Retry-After", String(retryAfterSeconds));
  return {
    allowed: false,
    response: respJson(ApiResponseCode.Error, "rate limit exceeded", undefined, {
      status: 429,
      headers,
    }),
  };
}

export function rateLimitOrThrow(
  req: Request,
  bucket: RateLimitBucket,
  options: { key?: string } = {}
): Response | null {
  const result = checkRateLimit(req, bucket, options);
  return result.allowed ? null : result.response;
}

export function resetRateLimitForTests() {
  buckets.clear();
}

export type { RateLimitBucket };
