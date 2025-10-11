import type { Logger, LoggerOptions, LogFields, LogLevel } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function getLevel(): LogLevel {
  const env = (process.env as any)?.LOG_LEVEL?.toLowerCase?.() || "";
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const redactKeys = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "api-key",
  "accesskey",
  "privatekey",
  "database_url",
];

function redact(obj: any): any {
  if (obj == null) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) return obj.map(redact);

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    const shouldRedact = redactKeys.some((rk) => lk.includes(rk));
    out[k] = shouldRedact ? "[REDACTED]" : redact(v);
  }
  return out;
}

function write(level: LogLevel, base: LogFields, obj?: LogFields, msg?: string) {
  const payload = Object.assign({}, base, obj || {});
  const line = { ts: nowIso(), level, ...(msg ? { message: msg } : {}), ...redact(payload) };
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
  return get("x-request-id") || get("cf-ray") || crypto.randomUUID();
}

