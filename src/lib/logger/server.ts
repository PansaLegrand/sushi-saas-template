import "server-only";
import type { Logger, LoggerOptions, LogFields } from "./types";
import pino from "pino";

function getLevel(): "debug" | "info" | "warn" | "error" {
  const env = (process.env.LOG_LEVEL || "").toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const redactPaths = [
  // Common headers
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "response.headers.set-cookie",
  "set-cookie",
  "authorization",
  "cookie",
  // Generic secret-looking keys
  "*.password*",
  "*.secret*",
  "*.token*",
  "*.apiKey*",
  "*.apikey*",
  "*.accessKey*",
  "*.privateKey*",
  // Known envs
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "STORAGE_SECRET_KEY",
  "STORAGE_ACCESS_KEY",
  "S3_SECRET_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
];

export function createLogger(options?: LoggerOptions): Logger {
  const level = options?.level || getLevel();
  const base: LogFields = options?.base || {};

  // Use plain Pino without transports to avoid worker path issues
  // in Next.js/Turbopack bundles. Pretty printing can be achieved by
  // piping output through `pino-pretty` externally if desired.
  const instance = pino({
    level,
    base,
    redact: { paths: redactPaths, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  const wrap = (bindings?: LogFields): Logger => {
    const child = bindings ? instance.child(bindings) : instance;
    return {
      debug: (obj?: LogFields, msg?: string) => (obj ? child.debug(obj, msg) : child.debug(msg)),
      info: (obj?: LogFields, msg?: string) => (obj ? child.info(obj, msg) : child.info(msg)),
      warn: (obj?: LogFields, msg?: string) => (obj ? child.warn(obj, msg) : child.warn(msg)),
      error: (obj?: LogFields, msg?: string) => (obj ? child.error(obj, msg) : child.error(msg)),
      child: (b?: LogFields) => wrap(b),
    };
  };

  return wrap();
}

export const logger = createLogger();

// Helper to extract a request_id consistently
export function requestIdFromHeaders(h: Headers | Record<string, string | null | undefined>): string {
  const get = (k: string) => {
    if (h instanceof Headers) return h.get(k);
    const v = (h as any)[k];
    return typeof v === "string" ? v : null;
  };
  return get("x-request-id") || get("x-amzn-trace-id") || get("cf-ray") || crypto.randomUUID();
}

export function withApiLogging<T extends (...args: any[]) => Promise<Response> | Response>(
  handler: T,
  opts?: { route?: string; event?: string }
) {
  return (async (...args: Parameters<T>): Promise<Response> => {
    const req: Request = args[0] as any;
    const start = Date.now();
    const rid = requestIdFromHeaders(req.headers);
    const log = logger.child({ request_id: rid, route: opts?.route });
    try {
      log.info({ event: opts?.event ? `${opts.event}.start` : "request.start", method: (req as any).method, url: (req as any).url });
      const res = await handler(...args);
      const dur = Date.now() - start;
      const status = (res as any).status || 200;
      log.info({ event: opts?.event ? `${opts?.event}.ok` : "request.ok", status, duration_ms: dur });
      return res;
    } catch (e: any) {
      const dur = Date.now() - start;
      const errObj = { name: e?.name, message: e?.message, code: e?.code };
      logger.error({ event: opts?.event ? `${opts?.event}.error` : "request.error", ...errObj, duration_ms: dur });
      throw e;
    }
  }) as T;
}
