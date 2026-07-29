import type { LogFields } from "./types";

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const MAX_DEPTH = 8;

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "databaseurl",
  "connectionstring",
];

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function configuredSecrets(): string[] {
  if (typeof process === "undefined" || !process.env) return [];

  return Object.entries(process.env)
    .filter(([key, value]) => isSensitiveKey(key) && Boolean(value) && value!.length >= 6)
    .map(([, value]) => value as string);
}

/**
 * Remove secrets embedded in otherwise useful diagnostic strings.
 *
 * Key-based redaction catches structured payloads. This second pass covers the
 * common failure case where an SDK puts a credential into `Error.message` or a
 * URL, which would otherwise bypass every path-based logger rule.
 */
export function redactLogString(
  value: string,
  secrets: readonly string[] = configuredSecrets()
): string {
  let redacted = value
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
      (_match, scheme: string) => `${scheme} ${REDACTED}`
    )
    .replace(
      /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+\b/g,
      REDACTED
    )
    .replace(/\bwhsec_[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
      `$1${REDACTED}@`
    );

  for (const secret of secrets) {
    redacted = redacted.split(secret).join(REDACTED);
  }

  return redacted;
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (typeof value === "string") return redactLogString(value, secrets);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return CIRCULAR;

  seen.add(value);

  if (value instanceof Error) {
    const errorFields: Record<string, unknown> = {
      name: value.name,
      message: redactLogString(value.message, secrets),
      stack: value.stack ? redactLogString(value.stack, secrets) : undefined,
    };

    for (const [key, nested] of Object.entries(value)) {
      errorFields[key] = isSensitiveKey(key)
        ? REDACTED
        : redactValue(nested, secrets, seen, depth + 1);
    }

    return errorFields;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactValue(item, secrets, seen, depth + 1)
    );
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : redactValue(nested, secrets, seen, depth + 1);
  }
  return output;
}

/** Recursively sanitize fields before either logger implementation sees them. */
export function redactLogFields(
  fields: LogFields,
  secrets: readonly string[] = configuredSecrets()
): LogFields {
  return redactValue(fields, secrets, new WeakSet(), 0) as LogFields;
}
