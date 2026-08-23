const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function inspectDevelopmentDatabaseUrl(raw, expectedDatabase) {
  const reasons = [];
  const url = parseUrl(raw);
  if (!url) {
    return { ok: false, reasons: ["is not a valid URL"] };
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    reasons.push("must use postgres:// or postgresql://");
  }
  if (!isLoopbackHost(url.hostname)) {
    reasons.push("must use a loopback host");
  }
  if ((url.port || "5432") !== "5432") {
    reasons.push("must use the local Compose port 5432");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database !== expectedDatabase) {
    reasons.push(`must name the ${expectedDatabase} database`);
  }

  return { ok: reasons.length === 0, reasons };
}

export function inspectDevelopmentRedisUrl(raw) {
  const reasons = [];
  const url = parseUrl(raw);
  if (!url) return { ok: false, reasons: ["is not a valid URL"] };

  if (url.protocol !== "redis:") {
    reasons.push("must use redis:// for the local service");
  }
  if (!isLoopbackHost(url.hostname)) {
    reasons.push("must use a loopback host");
  }
  if ((url.port || "6379") !== "6379") {
    reasons.push("must use the local Compose port 6379");
  }

  return { ok: reasons.length === 0, reasons };
}

export function inspectDevelopmentStorage(values) {
  const reasons = [];
  if (values.STORAGE_PROVIDER !== "garage") {
    reasons.push(
      "STORAGE_PROVIDER must be garage for the bundled local service",
    );
  }

  const endpoint = parseUrl(values.STORAGE_ENDPOINT ?? "");
  if (!endpoint) {
    reasons.push("STORAGE_ENDPOINT is not a valid URL");
  } else {
    if (!isLoopbackHost(endpoint.hostname)) {
      reasons.push("STORAGE_ENDPOINT must use a loopback host");
    }
    if ((endpoint.port || "80") !== "3900") {
      reasons.push("STORAGE_ENDPOINT must use the local Garage port 3900");
    }
  }

  if (values.STORAGE_BUCKET !== "sushi-dev") {
    reasons.push("STORAGE_BUCKET must be sushi-dev");
  }

  return { ok: reasons.length === 0, reasons };
}
