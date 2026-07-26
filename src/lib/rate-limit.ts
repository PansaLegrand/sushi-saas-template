import { getAppEnv } from "@/lib/env";
import { respCode } from "@/lib/errors/response";
import { logger } from "@/lib/logger/server";

type RateLimitBucket = "auth" | "checkout" | "feedback" | "credits" | "uploads" | "tasks";

type RateLimitRule = {
  limit: number;
  windowMs: number;
};

type RateLimitState = {
  count: number;
  resetAt: number;
};

type RateLimitStoreResult = {
  count: number;
  resetAt: number;
};

type RateLimitStore = {
  increment(key: string, windowMs: number): Promise<RateLimitStoreResult>;
  reset?(): void;
};

const RATE_LIMIT_RULES: Record<RateLimitBucket, RateLimitRule> = {
  auth: { limit: 20, windowMs: 60 * 1000 },
  checkout: { limit: 10, windowMs: 60 * 1000 },
  feedback: { limit: 5, windowMs: 60 * 1000 },
  credits: { limit: 30, windowMs: 60 * 1000 },
  uploads: { limit: 20, windowMs: 60 * 1000 },
  tasks: { limit: 10, windowMs: 60 * 1000 },
};

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitState>();

  async increment(key: string, windowMs: number): Promise<RateLimitStoreResult> {
    const now = Date.now();
    this.cleanupExpired(now);

    const existing = this.buckets.get(key);
    const state =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + windowMs };

    state.count += 1;
    this.buckets.set(key, state);

    return state;
  }

  reset(): void {
    this.buckets.clear();
  }

  private cleanupExpired(now: number) {
    if (this.buckets.size < 1000) {
      return;
    }

    for (const [key, state] of this.buckets) {
      if (state.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

class RedisRestRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  async increment(key: string, windowMs: number): Promise<RateLimitStoreResult> {
    const startedAt = Date.now();
    const endpoint = `${this.url.replace(/\/$/, "")}/pipeline`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
    });

    if (!response.ok) {
      throw new Error(`rate limit redis request failed: ${response.status}`);
    }

    const payload = (await response.json()) as { result?: unknown }[];
    const count = Number(payload[0]?.result);
    const ttlMs = Number(payload[2]?.result);

    if (!Number.isFinite(count) || count < 1) {
      throw new Error("rate limit redis returned an invalid count");
    }

    return {
      count,
      resetAt:
        Number.isFinite(ttlMs) && ttlMs > 0
          ? startedAt + ttlMs
          : startedAt + windowMs,
    };
  }
}

const memoryStore = new MemoryRateLimitStore();
let configuredStore: RateLimitStore | undefined;
let warnedStoreFailure = false;

function getConfiguredStore(): RateLimitStore {
  if (configuredStore) return configuredStore;

  const env = getAppEnv();
  if (env.RATE_LIMIT_REDIS_REST_URL && env.RATE_LIMIT_REDIS_REST_TOKEN) {
    configuredStore = new RedisRestRateLimitStore(
      env.RATE_LIMIT_REDIS_REST_URL,
      env.RATE_LIMIT_REDIS_REST_TOKEN
    );
  } else {
    configuredStore = memoryStore;
  }

  return configuredStore;
}

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
  const env = getAppEnv();
  const prefix = env.RATE_LIMIT_KEY_PREFIX || "sushi";
  return `${prefix}:rate_limit:${bucket}:${key ?? getRequestIp(req)}`;
}

export async function checkRateLimit(
  req: Request,
  bucket: RateLimitBucket,
  options: { key?: string } = {}
): Promise<
  | {
      allowed: true;
      headers: Headers;
    }
  | {
      allowed: false;
      response: Response;
    }
> {
  const rule = RATE_LIMIT_RULES[bucket];
  const key = getBucketKey(req, bucket, options.key);

  let state: RateLimitStoreResult;
  try {
    state = await getConfiguredStore().increment(key, rule.windowMs);
  } catch (error) {
    // Do not turn a Redis outage into a full-site outage. Fall back to the
    // local limiter and emit one loud process-level warning for operators.
    if (!warnedStoreFailure) {
      warnedStoreFailure = true;
      logger.error(
        { err: error, event: "rate_limit.store_failed", bucket },
        "distributed rate limit store failed; using in-memory fallback"
      );
    }
    state = await memoryStore.increment(`fallback:${key}`, rule.windowMs);
  }

  const remaining = Math.max(0, rule.limit - state.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
  const headers = new Headers({
    "RateLimit-Limit": String(rule.limit),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(Math.ceil(state.resetAt / 1000)),
  });

  if (state.count <= rule.limit) {
    return { allowed: true, headers };
  }

  headers.set("Retry-After", String(retryAfterSeconds));
  const response = respCode("REQUEST_RATE_LIMITED");
  for (const [name, value] of headers) {
    response.headers.set(name, value);
  }

  return {
    allowed: false,
    response,
  };
}

export async function rateLimitOrThrow(
  req: Request,
  bucket: RateLimitBucket,
  options: { key?: string } = {}
): Promise<Response | null> {
  const result = await checkRateLimit(req, bucket, options);
  return result.allowed ? null : result.response;
}

export function resetRateLimitForTests() {
  memoryStore.reset();
  configuredStore = undefined;
  warnedStoreFailure = false;
}

export type { RateLimitBucket };
