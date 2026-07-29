import { z } from "zod";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const STORAGE_PROVIDERS = ["s3", "r2", "minio"] as const;
type StorageProvider = (typeof STORAGE_PROVIDERS)[number];
const RATE_LIMIT_IP_SOURCES = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
] as const;
const MIN_PRODUCTION_SECRET_BYTES = 32;
const SECRET_PLACEHOLDER_PATTERN =
  /(?:change|replace)[\s_-]*(?:me|this)|placeholder|your[\s_-]*(?:secret|token)|example[\s_-]*(?:secret|token)/i;

function emptyToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

const envString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

const envUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().optional(),
);

const envRedisUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .url()
    .refine(
      (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
      {
        message: "Expected a redis:// or rediss:// URL",
      },
    )
    .optional(),
);

function envBoolean(defaultValue: boolean) {
  return z
    .preprocess(emptyToUndefined, z.union([z.boolean(), z.string()]).optional())
    .transform((value, ctx) => {
      if (value === undefined) {
        return defaultValue;
      }

      if (typeof value === "boolean") {
        return value;
      }

      // Trim before comparing: values pasted into a hosting dashboard commonly
      // carry a trailing space or newline, and failing on that is unhelpful.
      const normalized = value.trim().toLowerCase();
      if (TRUE_VALUES.has(normalized)) {
        return true;
      }

      if (FALSE_VALUES.has(normalized)) {
        return false;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected a boolean env value: true/false, 1/0, yes/no, or on/off. Received ${JSON.stringify(
          value.length > 40 ? `${value.slice(0, 40)}…` : value,
        )}`,
      });
      return z.NEVER;
    });
}

function envPositiveInt(defaultValue: number) {
  return z
    .preprocess(emptyToUndefined, z.coerce.number().int().positive().optional())
    .transform((value) => value ?? defaultValue);
}

const envStorageProvider = z
  .preprocess(emptyToUndefined, z.string().trim().optional())
  .transform((value, ctx): StorageProvider => {
    if (value === undefined) {
      return "s3";
    }

    const normalized = value.toLowerCase();
    if (STORAGE_PROVIDERS.includes(normalized as StorageProvider)) {
      return normalized as StorageProvider;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected one of: ${STORAGE_PROVIDERS.join(", ")}. Received ${JSON.stringify(
        value.length > 40 ? `${value.slice(0, 40)}…` : value,
      )}`,
    });
    return z.NEVER;
  });

const RawEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  npm_lifecycle_event: envString,
  NEXT_PHASE: envString,

  NEXT_PUBLIC_WEB_URL: envUrl,
  NEXT_PUBLIC_ADMIN_WEB_URL: envUrl,
  BETTER_AUTH_URL: envUrl,
  NEXT_PUBLIC_AUTH_BASE_URL: envUrl,
  NEXT_PUBLIC_APP_NAME: envString,
  NEXT_PUBLIC_PROJECT_NAME: envString,
  NEXT_PUBLIC_DOCS_URL: envUrl,
  NEXT_PUBLIC_AUTH_ENABLED: envBoolean(true),
  NEXT_PUBLIC_DEFAULT_THEME: envString,
  NEXT_PUBLIC_DEFAULT_LOCALE: envString,
  NEXT_PUBLIC_LOCALES: envString,
  NEXT_PUBLIC_LOCALE_DETECTION: envBoolean(false),

  DATABASE_URL: envString,
  BETTER_AUTH_SECRET: envString,
  AUTH_SECRET: envString,
  GOOGLE_CLIENT_ID: envString,
  GOOGLE_CLIENT_SECRET: envString,

  // Cloudflare Turnstile. Protects sign-in, sign-up, and the password-reset and
  // verification email endpoints from automated abuse.
  // Shared secret Vercel Cron sends as `Authorization: Bearer $CRON_SECRET`.
  CRON_SECRET: envString,

  NEXT_PUBLIC_CAPTCHA_ENABLED: envBoolean(true),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: envString,
  TURNSTILE_SECRET_KEY: envString,

  RESEND_API_KEY: envString,
  EMAIL_FROM: envString,

  /**
   * Print password-reset and verification links to the server log instead of
   * emailing them. Local development only — `validateAppEnv()` refuses to boot
   * a production runtime with this on, because the failure it would cause is
   * silent and total: every reset link would go to a log file nobody is reading
   * and no user would ever receive one.
   *
   * Without it, links are only logged when no provider is configured at all, so
   * adding a real `RESEND_API_KEY` for one test means every later signup sends
   * real mail to real inboxes.
   */
  AUTH_DEV_EMAIL_LINKS: envBoolean(false),

  STRIPE_PRIVATE_KEY: envString,
  STRIPE_WEBHOOK_SECRET: envString,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID: envString,
  NEXT_PUBLIC_PAY_SUCCESS_URL: envString,
  NEXT_PUBLIC_PAY_FAIL_URL: envString,
  NEXT_PUBLIC_PAY_CANCEL_URL: envString,
  STRIPE_PRICE_PLUS_MONTHLY: envString,
  STRIPE_PRICE_PLUS_YEARLY: envString,
  STRIPE_PRICE_MAX_MONTHLY: envString,
  STRIPE_PRICE_MAX_YEARLY: envString,
  STRIPE_PRICE_PLUS_MONTHLY_CNY: envString,
  STRIPE_PRICE_PLUS_YEARLY_CNY: envString,
  STRIPE_PRICE_MAX_MONTHLY_CNY: envString,
  STRIPE_PRICE_MAX_YEARLY_CNY: envString,
  // Deprecated public aliases. Billing configuration is server-owned.
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY_CNY: envString,
  // Legacy aliases retained for grandfathered Stripe subscriptions.
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY: envString,
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY: envString,

  STORAGE_PROVIDER: envStorageProvider,
  STORAGE_ENDPOINT: envUrl,
  STORAGE_REGION: envString,
  STORAGE_ACCESS_KEY: envString,
  STORAGE_SECRET_KEY: envString,
  STORAGE_BUCKET: envString,
  STORAGE_MAX_UPLOAD_MB: envPositiveInt(25),
  NEXT_PUBLIC_UPLOAD_MAX_MB: envPositiveInt(25),
  S3_ENDPOINT: envUrl,
  S3_REGION: envString,
  S3_ACCESS_KEY_ID: envString,
  S3_SECRET_ACCESS_KEY: envString,
  S3_BUCKET: envString,
  S3_FORCE_PATH_STYLE: envBoolean(false),
  S3_USE_ACL: envBoolean(false),

  // Upper bound on a single admin credit grant. Guards against a fat-fingered
  // amount in the admin console.
  ADMIN_MAX_CREDIT_GRANT: envPositiveInt(100000),

  RATE_LIMIT_REDIS_URL: envRedisUrl,
  RATE_LIMIT_IP_SOURCE: z.preprocess(
    emptyToUndefined,
    z.enum(RATE_LIMIT_IP_SOURCES).optional(),
  ),

  ENABLE_DEMO_FEATURES: envBoolean(false),
  ENABLE_CREDITS_PLAYGROUND: envBoolean(false),
  ENABLE_TEXT2VIDEO_MOCK: envBoolean(false),
  ENABLE_ACCOUNT_CREDIT_GRANT: envBoolean(false),
  RESERVATIONS_AUTO_SEED_DEMO: envBoolean(false),
  NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO: envBoolean(false),
  NEXT_PUBLIC_FEATURE_RESERVATIONS_ENABLED: envBoolean(false),
  TEXT2VIDEO_MOCK_URL: envString,

  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: envString,
  NEXT_PUBLIC_GOOGLE_ADCODE: envString,
  LOG_LEVEL: z
    .preprocess(
      emptyToUndefined,
      z.enum(["debug", "info", "warn", "error"]).optional(),
    )
    .default("info"),
  SLACK_WEBHOOK_URL: envUrl,
});

type RawEnv = z.infer<typeof RawEnvSchema>;

export type AppEnv = Omit<
  RawEnv,
  | "BETTER_AUTH_SECRET"
  | "AUTH_SECRET"
  | "STORAGE_ENDPOINT"
  | "S3_ENDPOINT"
  | "STORAGE_REGION"
  | "S3_REGION"
  | "STORAGE_ACCESS_KEY"
  | "S3_ACCESS_KEY_ID"
  | "STORAGE_SECRET_KEY"
  | "S3_SECRET_ACCESS_KEY"
  | "STORAGE_BUCKET"
  | "S3_BUCKET"
  | "RATE_LIMIT_IP_SOURCE"
> & {
  NEXT_PUBLIC_WEB_URL: string;
  BETTER_AUTH_URL: string;
  NEXT_PUBLIC_AUTH_BASE_URL: string;
  NEXT_PUBLIC_APP_NAME: string;
  NEXT_PUBLIC_PROJECT_NAME: string;
  NEXT_PUBLIC_DEFAULT_THEME: string;
  BETTER_AUTH_SECRET?: string;
  STORAGE_PROVIDER: StorageProvider;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_BUCKET?: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_USE_ACL: boolean;
  RATE_LIMIT_IP_SOURCE: (typeof RATE_LIMIT_IP_SOURCES)[number];
};

export class EnvValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "EnvValidationError";
  }
}

let cachedEnv: AppEnv | null = null;

export function isProductionRuntime(): boolean {
  const lifecycleEvent = process.env.npm_lifecycle_event ?? "";

  return (
    process.env.NODE_ENV === "production" &&
    lifecycleEvent !== "build" &&
    !lifecycleEvent.startsWith("build:") &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

/**
 * Reject secrets that are too short for production or are recognizable setup
 * placeholders. Entropy cannot be proven after a value has been generated, so
 * the deployment guide still requires a cryptographic generator.
 */
export function isStrongProductionSecret(value: string | undefined): boolean {
  const normalized = value?.trim();

  return Boolean(
    normalized &&
      new TextEncoder().encode(normalized).byteLength >=
        MIN_PRODUCTION_SECRET_BYTES &&
      !SECRET_PLACEHOLDER_PATTERN.test(normalized),
  );
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "env";
    return `${path}: ${issue.message}`;
  });
}

function buildAppEnv(raw: RawEnv): AppEnv {
  const webUrl = raw.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000";
  const authUrl = raw.BETTER_AUTH_URL ?? webUrl;

  return {
    ...raw,
    NEXT_PUBLIC_WEB_URL: webUrl,
    BETTER_AUTH_URL: authUrl,
    NEXT_PUBLIC_AUTH_BASE_URL: raw.NEXT_PUBLIC_AUTH_BASE_URL ?? authUrl,
    NEXT_PUBLIC_APP_NAME: raw.NEXT_PUBLIC_APP_NAME ?? "Your SaaS",
    NEXT_PUBLIC_PROJECT_NAME: raw.NEXT_PUBLIC_PROJECT_NAME ?? "your-saas",
    NEXT_PUBLIC_DEFAULT_THEME: raw.NEXT_PUBLIC_DEFAULT_THEME ?? "system",
    BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET ?? raw.AUTH_SECRET,
    STORAGE_PROVIDER: raw.STORAGE_PROVIDER,
    STORAGE_ENDPOINT: raw.STORAGE_ENDPOINT ?? raw.S3_ENDPOINT,
    STORAGE_REGION: raw.STORAGE_REGION ?? raw.S3_REGION ?? "auto",
    STORAGE_ACCESS_KEY: raw.STORAGE_ACCESS_KEY ?? raw.S3_ACCESS_KEY_ID,
    STORAGE_SECRET_KEY: raw.STORAGE_SECRET_KEY ?? raw.S3_SECRET_ACCESS_KEY,
    STORAGE_BUCKET: raw.STORAGE_BUCKET ?? raw.S3_BUCKET,
    RATE_LIMIT_IP_SOURCE: raw.RATE_LIMIT_IP_SOURCE ?? "x-forwarded-for",
  };
}

/**
 * Variables that are safe locally and dangerous in production.
 *
 * Distinct from the missing-variable check: these fail *open* rather than
 * loudly, so nothing downstream would ever surface the mistake.
 */
function getForbiddenProductionEnv(env: AppEnv): string[] {
  if (!isProductionRuntime()) {
    return [];
  }

  const forbidden: string[] = [];

  if (env.AUTH_DEV_EMAIL_LINKS) {
    forbidden.push(
      "AUTH_DEV_EMAIL_LINKS (would log password-reset links instead of emailing them)",
    );
  }

  return forbidden;
}

function getMissingProductionEnv(raw: RawEnv, env: AppEnv): string[] {
  if (!isProductionRuntime()) {
    return [];
  }

  const missing: string[] = [];
  const requireRaw = (value: unknown, name: string) => {
    if (value === undefined || value === "") {
      missing.push(name);
    }
  };
  const requireResolved = (value: unknown, name: string) => {
    if (value === undefined || value === "") {
      missing.push(name);
    }
  };
  const requireOneOf = (values: Array<string | undefined>, name: string) => {
    if (!values.some(Boolean)) {
      missing.push(name);
    }
  };

  requireRaw(raw.NEXT_PUBLIC_WEB_URL, "NEXT_PUBLIC_WEB_URL");

  requireRaw(raw.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  requireRaw(raw.NEXT_PUBLIC_AUTH_BASE_URL, "NEXT_PUBLIC_AUTH_BASE_URL");
  requireRaw(raw.DATABASE_URL, "DATABASE_URL");
  requireResolved(
    env.BETTER_AUTH_SECRET,
    "BETTER_AUTH_SECRET (or AUTH_SECRET)",
  );
  // The durable job queue is only useful if its public runner can authenticate.
  // Without this, production boots successfully and every scheduled delivery
  // (welcome mail, invitations, retries) fails closed forever.
  requireRaw(raw.CRON_SECRET, "CRON_SECRET");
  requireRaw(raw.STRIPE_PRIVATE_KEY, "STRIPE_PRIVATE_KEY");
  requireRaw(raw.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET");
  requireRaw(
    raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
    "STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
  );
  requireOneOf(
    [
      raw.STRIPE_PRICE_PLUS_MONTHLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY,
    ],
    "STRIPE_PRICE_PLUS_MONTHLY (or a legacy NEXT_PUBLIC alias)",
  );
  requireOneOf(
    [
      raw.STRIPE_PRICE_PLUS_YEARLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY,
    ],
    "STRIPE_PRICE_PLUS_YEARLY (or a legacy NEXT_PUBLIC alias)",
  );
  requireOneOf(
    [
      raw.STRIPE_PRICE_MAX_MONTHLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY,
    ],
    "STRIPE_PRICE_MAX_MONTHLY (or a legacy NEXT_PUBLIC alias)",
  );
  requireOneOf(
    [
      raw.STRIPE_PRICE_MAX_YEARLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY,
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY,
    ],
    "STRIPE_PRICE_MAX_YEARLY (or a legacy NEXT_PUBLIC alias)",
  );
  requireRaw(raw.RESEND_API_KEY, "RESEND_API_KEY");
  requireRaw(raw.EMAIL_FROM, "EMAIL_FROM");
  // The in-memory fallback is correct for one local process but is not a
  // production rate limiter: every serverless instance would keep a different
  // counter. A production app must therefore have one shared Redis store.
  requireRaw(raw.RATE_LIMIT_REDIS_URL, "RATE_LIMIT_REDIS_URL");
  // Fetch `Request` has no socket address. The app must know which header the
  // trusted edge overwrites; otherwise accepting an arbitrary X-Forwarded-For
  // value lets a caller choose a fresh limiter identity on every request.
  requireRaw(raw.RATE_LIMIT_IP_SOURCE, "RATE_LIMIT_IP_SOURCE");
  // Fail closed: a captcha that silently is not running is the exact failure
  // mode that gets an auth system botted. Set NEXT_PUBLIC_CAPTCHA_ENABLED=false
  // to opt out deliberately.
  if (env.NEXT_PUBLIC_CAPTCHA_ENABLED) {
    requireRaw(raw.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
    requireRaw(
      raw.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    );
  }

  requireResolved(env.STORAGE_BUCKET, "STORAGE_BUCKET (or S3_BUCKET)");
  requireResolved(
    env.STORAGE_ACCESS_KEY,
    "STORAGE_ACCESS_KEY (or S3_ACCESS_KEY_ID)",
  );
  requireResolved(
    env.STORAGE_SECRET_KEY,
    "STORAGE_SECRET_KEY (or S3_SECRET_ACCESS_KEY)",
  );

  return missing;
}

function getInvalidProductionEnv(raw: RawEnv, env: AppEnv): string[] {
  if (!isProductionRuntime()) {
    return [];
  }

  const invalid: string[] = [];

  if (
    env.BETTER_AUTH_SECRET &&
    !isStrongProductionSecret(env.BETTER_AUTH_SECRET)
  ) {
    invalid.push(
      "BETTER_AUTH_SECRET (or AUTH_SECRET; use at least 32 random bytes, not a placeholder)",
    );
  }

  if (raw.CRON_SECRET && !isStrongProductionSecret(raw.CRON_SECRET)) {
    invalid.push(
      "CRON_SECRET (use at least 32 random bytes, not a placeholder)",
    );
  }

  const stripePrices = {
    STRIPE_PRICE_PLUS_MONTHLY: raw.STRIPE_PRICE_PLUS_MONTHLY,
    STRIPE_PRICE_PLUS_YEARLY: raw.STRIPE_PRICE_PLUS_YEARLY,
    STRIPE_PRICE_MAX_MONTHLY: raw.STRIPE_PRICE_MAX_MONTHLY,
    STRIPE_PRICE_MAX_YEARLY: raw.STRIPE_PRICE_MAX_YEARLY,
    STRIPE_PRICE_PLUS_MONTHLY_CNY: raw.STRIPE_PRICE_PLUS_MONTHLY_CNY,
    STRIPE_PRICE_PLUS_YEARLY_CNY: raw.STRIPE_PRICE_PLUS_YEARLY_CNY,
    STRIPE_PRICE_MAX_MONTHLY_CNY: raw.STRIPE_PRICE_MAX_MONTHLY_CNY,
    STRIPE_PRICE_MAX_YEARLY_CNY: raw.STRIPE_PRICE_MAX_YEARLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY,
    NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY,
    NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY,
    NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY,
    NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY,
    NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY,
    NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY,
    NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY,
    NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY,
    NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY:
      raw.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY,
  };

  for (const [name, value] of Object.entries(stripePrices)) {
    if (value && !/^price_[A-Za-z0-9]+$/.test(value)) {
      invalid.push(`${name} (must be a Stripe Price ID beginning with price_)`);
    }
  }

  if (
    raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID &&
    !/^bpc_[A-Za-z0-9]+$/.test(raw.STRIPE_BILLING_PORTAL_CONFIGURATION_ID)
  ) {
    invalid.push(
      "STRIPE_BILLING_PORTAL_CONFIGURATION_ID (must be a Stripe Billing Portal configuration ID beginning with bpc_)",
    );
  }

  return invalid;
}

export function validateAppEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = RawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    throw new EnvValidationError(
      `Invalid environment configuration:\n- ${issues.join("\n- ")}`,
      issues,
    );
  }

  const env = buildAppEnv(parsed.data);

  // Both problems in one throw. Reported separately, an operator fixes the
  // missing variables, redeploys, and only then learns about the forbidden one
  // — two failed deploys for one bad config file.
  const missing = getMissingProductionEnv(parsed.data, env);
  const forbidden = getForbiddenProductionEnv(env);
  const invalid = getInvalidProductionEnv(parsed.data, env);

  if (missing.length > 0 || forbidden.length > 0 || invalid.length > 0) {
    const sections: string[] = [];
    if (missing.length > 0) {
      sections.push(
        `Missing required production environment variables:\n- ${missing.join("\n- ")}`,
      );
    }
    if (forbidden.length > 0) {
      sections.push(
        `Environment variables that must not be set in production:\n- ${forbidden.join(
          "\n- ",
        )}`,
      );
    }
    if (invalid.length > 0) {
      sections.push(
        `Invalid production environment variables:\n- ${invalid.join("\n- ")}`,
      );
    }

    throw new EnvValidationError(sections.join("\n\n"), [
      ...missing,
      ...forbidden,
      ...invalid,
    ]);
  }

  cachedEnv = env;
  return env;
}

export function getAppEnv(): AppEnv {
  return validateAppEnv();
}

export function getRequiredEnv<K extends keyof AppEnv>(
  key: K,
): NonNullable<AppEnv[K]> {
  const value = getAppEnv()[key];
  if (value === undefined || value === "") {
    throw new EnvValidationError(
      `Missing required environment variable: ${String(key)}`,
      [String(key)],
    );
  }

  return value as NonNullable<AppEnv[K]>;
}

export function resetEnvCacheForTests() {
  cachedEnv = null;
}
