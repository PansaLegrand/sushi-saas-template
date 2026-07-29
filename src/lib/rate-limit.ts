import { createClient } from "redis";
import { createHmac } from "node:crypto";

import { getAppEnv, isProductionRuntime } from "@/lib/env";
import { normalizeEmail } from "@/lib/email-address";
import { respCode } from "@/lib/errors/response";
import { logger } from "@/lib/logger/server";

type RateLimitBucket =
  | "auth"
  | "auth-signup"
  | "auth-signin"
  | "auth-recovery"
  | "auth-sensitive"
  | "checkout"
  | "feedback"
  | "credits"
  | "uploads"
  | "tasks"
  | "moderation";

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
  ping?(): Promise<void>;
  close?(): Promise<void>;
  reset?(): void;
};

const RATE_LIMIT_RULES: Record<RateLimitBucket, RateLimitRule> = {
  auth: { limit: 20, windowMs: 60 * 1000 },
  // Creating identities is both expensive and a common abuse target. Turnstile
  // remains the bot challenge; this bounds successful challenge reuse and
  // scripted traffic that reaches the application.
  "auth-signup": { limit: 5, windowMs: 15 * 60 * 1000 },
  "auth-signin": { limit: 10, windowMs: 60 * 1000 },
  // These endpoints send email. Share one deliberately small bucket so an
  // attacker cannot multiply the allowance by alternating reset and verify.
  "auth-recovery": { limit: 5, windowMs: 15 * 60 * 1000 },
  // Password changes, email changes, session revocation, and 2FA changes are
  // authenticated but security-sensitive.
  "auth-sensitive": { limit: 10, windowMs: 5 * 60 * 1000 },
  checkout: { limit: 10, windowMs: 60 * 1000 },
  feedback: { limit: 5, windowMs: 60 * 1000 },
  credits: { limit: 30, windowMs: 60 * 1000 },
  uploads: { limit: 20, windowMs: 60 * 1000 },
  tasks: { limit: 10, windowMs: 60 * 1000 },
  // Deliberately roomier than the rest. This bucket guards admin-only endpoints
  // whose whole purpose is responding to a flood — throttling the operator
  // fighting an abuse wave is throttling the wrong party. It exists to bound a
  // runaway script, not to pace a human.
  moderation: { limit: 60, windowMs: 60 * 1000 },
};

const AUTH_SIGNIN_ENDPOINTS = new Set(["/sign-in/email", "/sign-in/social"]);

const AUTH_RECOVERY_ENDPOINTS = new Set([
  "/request-password-reset",
  "/forget-password",
  "/send-verification-email",
]);

const AUTH_SENSITIVE_ENDPOINTS = new Set([
  "/reset-password",
  "/change-password",
  "/change-email",
  "/delete-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
]);

const FAIL_CLOSED_BUCKETS = new Set<RateLimitBucket>([
  "auth-signup",
  "auth-signin",
  "auth-recovery",
  "auth-sensitive",
  "checkout",
]);

function getAuthEndpoint(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const authPrefix = "/api/auth";
  const prefixIndex = pathname.indexOf(authPrefix);

  if (prefixIndex === -1) {
    return pathname;
  }

  return pathname.slice(prefixIndex + authPrefix.length) || "/";
}

/**
 * Better Auth exposes every action through one catch-all route, but those
 * actions do not have the same abuse cost. Keep the routing decision here so a
 * new auth endpoint cannot accidentally invent a second limiter convention.
 */
export function getAuthRateLimitBucket(req: Request): RateLimitBucket {
  const endpoint = getAuthEndpoint(req);

  if (endpoint === "/sign-up/email") {
    return "auth-signup";
  }

  if (AUTH_SIGNIN_ENDPOINTS.has(endpoint)) {
    return "auth-signin";
  }

  if (AUTH_RECOVERY_ENDPOINTS.has(endpoint)) {
    return "auth-recovery";
  }

  if (
    AUTH_SENSITIVE_ENDPOINTS.has(endpoint) ||
    endpoint.startsWith("/two-factor/")
  ) {
    return "auth-sensitive";
  }

  return "auth";
}

/**
 * A privacy-safe secondary key for account-targeted auth requests.
 *
 * Auth routes are always limited by IP first. This hashed account key adds the
 * complementary control: rotating source IPs cannot give one email address an
 * unlimited password/recovery attempt budget.
 */
export async function getAuthIdentityRateLimitKey(
  req: Request,
): Promise<string | undefined> {
  try {
    const body = (await req.clone().json()) as { email?: unknown };
    if (typeof body.email !== "string") return undefined;

    const email = normalizeEmail(body.email);
    if (!email) return undefined;

    const secret =
      getAppEnv().BETTER_AUTH_SECRET || "local-only-rate-limit-identity-secret";
    return `account:${createHmac("sha256", secret)
      .update(email)
      .digest("hex")}`;
  } catch {
    // Invalid JSON belongs to the auth handler's validation path. It still
    // consumes the IP allowance above, but there is no safe identity to key.
    return undefined;
  }
}

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitState>();

  async increment(
    key: string,
    windowMs: number,
  ): Promise<RateLimitStoreResult> {
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

  async ping(): Promise<void> {
    // The local store has no dependency to probe.
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

const INCREMENT_WITH_EXPIRY_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

class RedisRateLimitStore implements RateLimitStore {
  private readonly client;
  private connectPromise: Promise<void> | undefined;

  constructor(url: string) {
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_500,
        reconnectStrategy: (retries) =>
          retries >= 2 ? false : Math.min(100 * 2 ** retries, 500),
      },
    });

    // Node Redis requires an error listener. Request-level failures are logged
    // once by checkRateLimit(), where the bucket and fallback decision are
    // available; logging here would duplicate every reconnect error.
    this.client.on("error", () => undefined);
  }

  async increment(
    key: string,
    windowMs: number,
  ): Promise<RateLimitStoreResult> {
    const client = await this.getConnectedClient();
    const result = await client.eval(INCREMENT_WITH_EXPIRY_SCRIPT, {
      keys: [key],
      arguments: [String(windowMs)],
    });

    if (!Array.isArray(result)) {
      throw new Error("rate limit redis returned an invalid result");
    }

    const count = Number(result[0]);
    const ttlMs = Number(result[1]);

    if (!Number.isFinite(count) || count < 1) {
      throw new Error("rate limit redis returned an invalid count");
    }

    return {
      count,
      resetAt:
        Number.isFinite(ttlMs) && ttlMs > 0
          ? Date.now() + ttlMs
          : Date.now() + windowMs,
    };
  }

  async close(): Promise<void> {
    this.connectPromise = undefined;
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async ping(): Promise<void> {
    const client = await this.getConnectedClient();
    await client.ping();
  }

  private async getConnectedClient() {
    if (!this.client.isOpen) {
      this.connectPromise ??= this.client.connect().then(
        () => undefined,
        (error: unknown) => {
          this.connectPromise = undefined;
          throw error;
        },
      );
      await this.connectPromise;
    }

    return this.client;
  }
}

const memoryStore = new MemoryRateLimitStore();
let configuredStore: RateLimitStore | undefined;
let warnedStoreFailure = false;

function getConfiguredStore(): RateLimitStore {
  if (configuredStore) return configuredStore;

  const env = getAppEnv();
  if (env.RATE_LIMIT_REDIS_URL) {
    configuredStore = new RedisRateLimitStore(env.RATE_LIMIT_REDIS_URL);
  } else {
    configuredStore = memoryStore;
  }

  return configuredStore;
}

function getRequestIp(req: Request): string {
  const source = getAppEnv().RATE_LIMIT_IP_SOURCE;

  if (source === "x-forwarded-for") {
    const forwardedFor = req.headers.get(source);
    if (forwardedFor) {
      return forwardedFor.split(",")[0]?.trim() || "unknown";
    }

    return "unknown";
  }

  return req.headers.get(source)?.trim() || "unknown";
}

function getBucketKey(
  req: Request,
  bucket: RateLimitBucket,
  key?: string,
): string {
  return `rate_limit:${bucket}:${key ?? getRequestIp(req)}`;
}

export async function checkRateLimit(
  req: Request,
  bucket: RateLimitBucket,
  options: { key?: string } = {},
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
    // Authentication and checkout are the high-value abuse paths. In
    // production, a process-local fallback would let an attacker multiply the
    // allowance by the number of instances, so those paths fail closed while
    // Redis is unavailable. Lower-risk product actions keep the availability-
    // first local fallback.
    if (!warnedStoreFailure) {
      warnedStoreFailure = true;
      logger.error(
        { err: error, event: "rate_limit.store_failed", bucket },
        "distributed rate limit store failed",
      );
    }

    if (isProductionRuntime() && FAIL_CLOSED_BUCKETS.has(bucket)) {
      const response = respCode("SERVICE_UNAVAILABLE");
      response.headers.set("Retry-After", "5");
      return { allowed: false, response };
    }

    state = await memoryStore.increment(`fallback:${key}`, rule.windowMs);
  }

  const remaining = Math.max(0, rule.limit - state.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((state.resetAt - Date.now()) / 1000),
  );
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
  options: { key?: string } = {},
): Promise<Response | null> {
  const result = await checkRateLimit(req, bucket, options);
  return result.allowed ? null : result.response;
}

/**
 * Readiness probe for the configured limiter dependency.
 *
 * Lower-risk request limiting deliberately falls back to memory during a Redis
 * outage; authentication and checkout fail closed in production. Readiness
 * still reports the shared store as unavailable so operators can see either
 * degraded protection or unavailable critical mutations.
 */
export async function checkRateLimitStoreReady(): Promise<{
  distributed: boolean;
}> {
  const store = getConfiguredStore();
  await store.ping?.();
  return { distributed: store !== memoryStore };
}

export function resetRateLimitForTests() {
  memoryStore.reset();
  configuredStore = undefined;
  warnedStoreFailure = false;
}

export async function closeRateLimitStoreForTests() {
  const store = configuredStore;
  configuredStore = undefined;
  warnedStoreFailure = false;
  memoryStore.reset();
  await store?.close?.();
}

export type { RateLimitBucket };
