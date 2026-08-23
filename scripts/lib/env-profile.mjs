export const PROFILE_FILES = {
  development: {
    app: ".env.development.local",
    studio: "apps/content-studio/.env.development.local",
  },
  production: {
    app: ".env.production.local",
    studio: "apps/content-studio/.env.production.local",
  },
};

const PROFILE_ALIASES = new Map([
  ["dev", "development"],
  ["development", "development"],
  ["local", "development"],
  ["prod", "production"],
  ["production", "production"],
]);

export function normalizeProfile(value) {
  return PROFILE_ALIASES.get(value?.trim().toLowerCase()) ?? null;
}

function linePattern(key) {
  return new RegExp(
    `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.*)$`,
    "m",
  );
}

export function readEnvValue(contents, key) {
  const match = contents.match(linePattern(key));
  if (!match) return "";

  const value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return "";
    }
  }

  return value;
}

export function formatEnvValue(value) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Environment values cannot contain newlines.");
  }

  return value === "" || /^[A-Za-z0-9_./:@+,-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

export function isSetupPlaceholder(value) {
  return /^(?:change|replace)[-_ ]?with|^(?:change|replace)[-_ ]?me/i.test(
    value.trim(),
  );
}

/**
 * Update one key without reformatting the rest of the documented template.
 * Unknown keys are appended so values from an older local profile survive a
 * migration to the current profile format.
 */
export function setEnvValue(contents, key, value, options = {}) {
  const { overwrite = true } = options;
  const pattern = linePattern(key);
  const match = contents.match(pattern);

  if (match && !overwrite && readEnvValue(contents, key) !== "") {
    return contents;
  }

  const line = `${key}=${formatEnvValue(value)}`;
  if (match) return contents.replace(pattern, line);

  const separator = contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${line}\n`;
}

export function applyEnvValues(contents, values, options = {}) {
  return Object.entries(values).reduce(
    (result, [key, value]) => setEnvValue(result, key, value, options),
    contents,
  );
}

export function prepareAppProfile(contents, profile, secret) {
  const generated = {
    BETTER_AUTH_SECRET: secret("base64"),
    CRON_SECRET: secret("hex"),
    MARKETING_UNSUBSCRIBE_SECRET: secret("hex"),
  };

  let result = applyEnvValues(contents, generated, { overwrite: false });

  if (profile === "development") {
    result = applyEnvValues(
      result,
      {
        DATABASE_URL: "postgresql://sushi:sushi@localhost:5432/sushi_dev",
        TEST_DATABASE_URL: "postgresql://sushi:sushi@localhost:5432/sushi_test",
        RATE_LIMIT_REDIS_URL: "redis://localhost:6379",
        TEST_REDIS_URL: "redis://localhost:6379",
        CONTENT_MARKETING_SECRET: secret("hex"),
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      },
      { overwrite: false },
    );

    const hasMaterialStorageConfig = [
      "STORAGE_ENDPOINT",
      "STORAGE_ACCESS_KEY",
      "STORAGE_SECRET_KEY",
      "STORAGE_BUCKET",
    ].some((key) => readEnvValue(result, key) !== "");

    if (!hasMaterialStorageConfig) {
      result = applyEnvValues(result, {
        STORAGE_PROVIDER: "garage",
        STORAGE_ENDPOINT: "http://localhost:3900",
        STORAGE_REGION: "garage",
        STORAGE_ACCESS_KEY: "GK0123456789abcdef01234567",
        STORAGE_SECRET_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        STORAGE_BUCKET: "sushi-dev",
        S3_FORCE_PATH_STYLE: "true",
        S3_USE_ACL: "false",
      });
    }
  } else {
    // These values are never valid in a production profile. Clear them even on
    // a re-run so a copied development file cannot aim destructive tests at a
    // real environment or silently enable demo-only behavior.
    result = applyEnvValues(result, {
      TEST_DATABASE_URL: "",
      TEST_REDIS_URL: "",
      AUTH_DEV_EMAIL_LINKS: "false",
      ENABLE_DEMO_FEATURES: "false",
      ENABLE_CREDITS_PLAYGROUND: "false",
      ENABLE_TEXT2VIDEO_MOCK: "false",
      ENABLE_ACCOUNT_CREDIT_GRANT: "false",
      RESERVATIONS_AUTO_SEED_DEMO: "false",
      NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO: "false",
    });
  }

  return result;
}

export function prepareStudioProfile(contents, profile, secret) {
  const existingPayloadSecret = readEnvValue(contents, "PAYLOAD_SECRET");
  let result = setEnvValue(contents, "PAYLOAD_SECRET", secret("hex"), {
    overwrite:
      existingPayloadSecret === "" || isSetupPlaceholder(existingPayloadSecret),
  });

  if (profile === "development") {
    result = applyEnvValues(
      result,
      {
        CONTENT_DATABASE_URL:
          "postgresql://sushi:sushi@localhost:5432/sushi_content",
        CONTENT_STUDIO_URL: "http://localhost:3002",
        SAAS_MARKETING_API_URL: "http://localhost:3000",
        CONTENT_CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
      },
      { overwrite: false },
    );
  }

  return result;
}
