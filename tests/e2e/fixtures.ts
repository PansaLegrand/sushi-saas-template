const externalBaseUrl = process.env.E2E_BASE_URL?.trim();
const externalEmail = process.env.E2E_USER_EMAIL?.trim();
const externalPassword = process.env.E2E_USER_PASSWORD?.trim();

if (externalBaseUrl && (!externalEmail || !externalPassword)) {
  throw new Error(
    "E2E_USER_EMAIL and E2E_USER_PASSWORD are required with E2E_BASE_URL.",
  );
}

export const E2E_USER = {
  email: externalEmail || "demo@example.test",
  password: externalPassword || "DemoPass123!",
};

export const E2E_MUTATIONS_ENABLED =
  !process.env.E2E_BASE_URL || process.env.E2E_ALLOW_MUTATIONS === "1";

export const E2E_CRON_SECRET =
  process.env.E2E_CRON_SECRET ||
  "e2e-cron-secret-0123456789abcdef0123456789";

export const E2E_WORKER_ENABLED =
  !process.env.E2E_BASE_URL || Boolean(process.env.E2E_CRON_SECRET);

export function emptyStorageState() {
  return { cookies: [], origins: [] };
}
