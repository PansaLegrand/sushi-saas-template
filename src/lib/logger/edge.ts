import type { Logger, LoggerOptions, LogFields, LogLevel } from "./types";
import { redactLogFields, redactLogString } from "./redact";
import { normalizeRequestId } from "./request-id";

function nowIso() {
  return new Date().toISOString();
}

function getLevel(): LogLevel {
  const env = (process.env as any)?.LOG_LEVEL?.toLowerCase?.() || "";
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, base: LogFields, obj?: LogFields, msg?: string) {
  const payload = redactLogFields(Object.assign({}, base, obj || {}));
  const line = {
    ts: nowIso(),
    level,
    ...(msg ? { message: redactLogString(msg) } : {}),
    ...payload,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export function createLogger(options?: LoggerOptions): Logger {
  const level = options?.level || getLevel();
  const base: LogFields = options?.base || {};

  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const thresholdIdx = order.indexOf(level);

  const can = (lvl: LogLevel) => order.indexOf(lvl) >= thresholdIdx;

  const api: Logger = {
    debug: (obj?: LogFields, msg?: string) => {
      if (can("debug")) write("debug", base, obj, msg);
    },
    info: (obj?: LogFields, msg?: string) => {
      if (can("info")) write("info", base, obj, msg);
    },
    warn: (obj?: LogFields, msg?: string) => {
      if (can("warn")) write("warn", base, obj, msg);
    },
    error: (obj?: LogFields, msg?: string) => {
      if (can("error")) write("error", base, obj, msg);
    },
    child: (bindings?: LogFields) => createLogger({ level, base: { ...base, ...(bindings || {}) } }),
  };

  return api;
}

export const logger = createLogger();

export function requestIdFromHeaders(h: Headers | Record<string, string | null | undefined>): string {
  const get = (k: string) => {
    if (h instanceof Headers) return h.get(k);
    const v = (h as any)[k];
    return typeof v === "string" ? v : null;
  };
  return normalizeRequestId(get("x-request-id") || get("cf-ray"));
}
