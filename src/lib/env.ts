import { z } from "zod";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function emptyToUndefined(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

const envString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional()
);

const envUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().optional()
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
          value.length > 40 ? `${value.slice(0, 40)}…` : value
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
  NEXT_PUBLIC_AUTH_ENABLED: envBoolean(true),
  NEXT_PUBLIC_DEFAULT_THEME: envString,
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

  STRIPE_PRIVATE_KEY: envString,
  STRIPE_WEBHOOK_SECRET: envString,
  NEXT_PUBLIC_PAY_SUCCESS_URL: envString,
  NEXT_PUBLIC_PAY_FAIL_URL: envString,
  NEXT_PUBLIC_PAY_CANCEL_URL: envString,

  STORAGE_PROVIDER: envString,
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

  RATE_LIMIT_REDIS_REST_URL: envUrl,
  RATE_LIMIT_REDIS_REST_TOKEN: envString,
  RATE_LIMIT_KEY_PREFIX: envString,

  ENABLE_DEMO_FEATURES: envBoolean(false),
  ENABLE_CREDITS_PLAYGROUND: envBoolean(false),
  ENABLE_TEXT2VIDEO_MOCK: envBoolean(false),
  ENABLE_ACCOUNT_CREDIT_GRANT: envBoolean(false),
  RESERVATIONS_AUTO_SEED_DEMO: envBoolean(false),
  NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO: envBoolean(false),
  NEXT_PUBLIC_FEATURE_RESERVATIONS_ENABLED: envBoolean(true),
  TEXT2VIDEO_MOCK_URL: envString,

  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: envString,
  NEXT_PUBLIC_GOOGLE_ADCODE: envString,
  LOG_LEVEL: z
    .preprocess(emptyToUndefined, z.enum(["debug", "info", "warn", "error"]).optional())
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
> & {
  NEXT_PUBLIC_WEB_URL: string;
  BETTER_AUTH_URL: string;
  NEXT_PUBLIC_AUTH_BASE_URL: string;
  NEXT_PUBLIC_APP_NAME: string;
  NEXT_PUBLIC_PROJECT_NAME: string;
  NEXT_PUBLIC_DEFAULT_THEME: string;
  BETTER_AUTH_SECRET?: string;
  STORAGE_PROVIDER: string;
  STORAGE_ENDPOINT?: string;
  STORAGE_REGION: string;
  STORAGE_ACCESS_KEY?: string;
  STORAGE_SECRET_KEY?: string;
  STORAGE_BUCKET?: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_USE_ACL: boolean;
};

export class EnvValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[]
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
    NEXT_PUBLIC_APP_NAME: raw.NEXT_PUBLIC_APP_NAME ?? "Sushi SaaS",
    NEXT_PUBLIC_PROJECT_NAME: raw.NEXT_PUBLIC_PROJECT_NAME ?? "sushi-saas-template",
    NEXT_PUBLIC_DEFAULT_THEME: raw.NEXT_PUBLIC_DEFAULT_THEME ?? "system",
    BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET ?? raw.AUTH_SECRET,
    STORAGE_PROVIDER: (raw.STORAGE_PROVIDER ?? "s3").toLowerCase(),
    STORAGE_ENDPOINT: raw.STORAGE_ENDPOINT ?? raw.S3_ENDPOINT,
    STORAGE_REGION: raw.STORAGE_REGION ?? raw.S3_REGION ?? "auto",
    STORAGE_ACCESS_KEY: raw.STORAGE_ACCESS_KEY ?? raw.S3_ACCESS_KEY_ID,
    STORAGE_SECRET_KEY: raw.STORAGE_SECRET_KEY ?? raw.S3_SECRET_ACCESS_KEY,
    STORAGE_BUCKET: raw.STORAGE_BUCKET ?? raw.S3_BUCKET,
  };
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

  requireRaw(raw.NEXT_PUBLIC_WEB_URL, "NEXT_PUBLIC_WEB_URL");
  requireRaw(raw.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  requireRaw(raw.NEXT_PUBLIC_AUTH_BASE_URL, "NEXT_PUBLIC_AUTH_BASE_URL");
  requireRaw(raw.DATABASE_URL, "DATABASE_URL");
  requireResolved(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET (or AUTH_SECRET)");
  requireRaw(raw.STRIPE_PRIVATE_KEY, "STRIPE_PRIVATE_KEY");
  requireRaw(raw.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET");
  requireRaw(raw.RESEND_API_KEY, "RESEND_API_KEY");
  requireRaw(raw.EMAIL_FROM, "EMAIL_FROM");
  // Fail closed: a captcha that silently is not running is the exact failure
  // mode that gets an auth system botted. Set NEXT_PUBLIC_CAPTCHA_ENABLED=false
  // to opt out deliberately.
  if (env.NEXT_PUBLIC_CAPTCHA_ENABLED) {
    requireRaw(raw.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
    requireRaw(
      raw.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
    );
  }

  requireResolved(env.STORAGE_BUCKET, "STORAGE_BUCKET (or S3_BUCKET)");
  requireResolved(env.STORAGE_ACCESS_KEY, "STORAGE_ACCESS_KEY (or S3_ACCESS_KEY_ID)");
  requireResolved(env.STORAGE_SECRET_KEY, "STORAGE_SECRET_KEY (or S3_SECRET_ACCESS_KEY)");

  return missing;
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
      issues
    );
  }

  const env = buildAppEnv(parsed.data);
  const missing = getMissingProductionEnv(parsed.data, env);
  if (missing.length > 0) {
    throw new EnvValidationError(
      `Missing required production environment variables:\n- ${missing.join(
        "\n- "
      )}`,
      missing
    );
  }

  cachedEnv = env;
  return env;
}

export function getAppEnv(): AppEnv {
  return validateAppEnv();
}

export function getRequiredEnv<K extends keyof AppEnv>(
  key: K
): NonNullable<AppEnv[K]> {
  const value = getAppEnv()[key];
  if (value === undefined || value === "") {
    throw new EnvValidationError(`Missing required environment variable: ${String(key)}`, [
      String(key),
    ]);
  }

  return value as NonNullable<AppEnv[K]>;
}

export function resetEnvCacheForTests() {
  cachedEnv = null;
}
