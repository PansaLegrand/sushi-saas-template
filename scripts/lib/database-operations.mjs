const SCRATCH_NAME_PATTERN = /(?:^|[_-])(?:restore|scratch|drill)(?:[_-]|$)/i;
const PROTECTED_LOCAL_DATABASES = new Set([
  "postgres",
  "template0",
  "template1",
  "sushi_dev",
  "sushi_test",
  "sushi_content",
]);

export function parsePostgresUrl(raw) {
  try {
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return null;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database) return null;
    return { url, database };
  } catch {
    return null;
  }
}

export function inspectRestoreTarget(raw, confirmation) {
  const parsed = parsePostgresUrl(raw);
  if (!parsed) {
    return {
      ok: false,
      database: null,
      reasons: ["must be a valid postgres:// or postgresql:// URL"],
    };
  }

  const reasons = [];
  if (PROTECTED_LOCAL_DATABASES.has(parsed.database)) {
    reasons.push(`${parsed.database} is a protected application database`);
  }
  if (!SCRATCH_NAME_PATTERN.test(parsed.database)) {
    reasons.push("database name must contain restore, scratch, or drill");
  }
  if (confirmation !== parsed.database) {
    reasons.push(`confirmation must exactly equal ${parsed.database}`);
  }

  return { ok: reasons.length === 0, database: parsed.database, reasons };
}

/** A connection URL safe for child-process arguments and diagnostic output. */
export function databaseConnectionParts(raw) {
  const parsed = parsePostgresUrl(raw);
  if (!parsed) throw new Error("invalid PostgreSQL URL");

  const password = decodeURIComponent(parsed.url.password);
  const username = decodeURIComponent(parsed.url.username);
  const safeUrl = new URL(parsed.url);
  safeUrl.password = "";

  return {
    database: parsed.database,
    hostname: parsed.url.hostname,
    port: parsed.url.port || "5432",
    username,
    password,
    safeUrl: safeUrl.toString(),
  };
}

export function safeBackupLabel(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return normalized.slice(0, 64) || "database";
}
