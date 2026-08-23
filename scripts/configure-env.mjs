#!/usr/bin/env node
/**
 * Create an ignored, environment-specific configuration file from the tracked
 * examples. Internal secrets are generated; provider credentials are entered
 * only when the developer opts into the guided prompts.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

import {
  PROFILE_FILES,
  applyEnvValues,
  isSetupPlaceholder,
  normalizeProfile,
  prepareAppProfile,
  prepareStudioProfile,
  readEnvValue,
  setEnvValue,
} from "./lib/env-profile.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const profileArg = args.find((arg) => !arg.startsWith("--"));
const profile = normalizeProfile(profileArg ?? "development");
const nonInteractive =
  args.includes("--non-interactive") || !process.stdin.isTTY;

function usage() {
  console.log(`Usage: node scripts/configure-env.mjs <development|production> [--non-interactive]

Creates an ignored profile without overwriting existing values:
  development  .env.development.local
  production   .env.production.local

Production profile preparation never deploys, migrates a database, or sends
credentials anywhere.`);
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

if (!profile) {
  console.error(`Unknown environment: ${profileArg ?? ""}\n`);
  usage();
  process.exit(1);
}

const info = (message) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);
const note = (message) => console.log(`  \x1b[33m!\x1b[0m ${message}`);
const heading = (message) => console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
const secret = (encoding) => randomBytes(32).toString(encoding);

async function hiddenQuestion(rl, prompt) {
  process.stdout.write(prompt);
  const restoreEcho = () => {
    spawnSync("stty", ["echo"], {
      stdio: ["inherit", "ignore", "ignore"],
    });
  };
  const interrupt = () => {
    restoreEcho();
    process.stdout.write("\n");
    process.exit(130);
  };

  process.once("SIGINT", interrupt);
  spawnSync("stty", ["-echo"], {
    stdio: ["inherit", "ignore", "ignore"],
  });
  try {
    return await rl.question("");
  } finally {
    process.removeListener("SIGINT", interrupt);
    restoreEcho();
    process.stdout.write("\n");
  }
}

function seedFromExample(exampleRelativePath, legacyRelativePaths) {
  const examplePath = resolve(root, exampleRelativePath);
  if (!existsSync(examplePath)) {
    throw new Error(`${exampleRelativePath} is missing.`);
  }

  let contents = readFileSync(examplePath, "utf8");
  if (profile !== "development")
    return { contents, source: exampleRelativePath };

  const legacyPath = legacyRelativePaths
    .map((relativePath) => ({
      relativePath,
      path: resolve(root, relativePath),
    }))
    .find(({ path }) => existsSync(path));

  if (!legacyPath) return { contents, source: exampleRelativePath };

  contents = applyEnvValues(contents, parse(readFileSync(legacyPath.path)));
  return { contents, source: legacyPath.relativePath };
}

function loadAppProfile() {
  const relativePath = PROFILE_FILES[profile].app;
  const targetPath = resolve(root, relativePath);
  if (existsSync(targetPath)) {
    return {
      contents: readFileSync(targetPath, "utf8"),
      relativePath,
      targetPath,
      created: false,
      source: relativePath,
    };
  }

  const seeded = seedFromExample(".env.example", [".env.local", ".env"]);
  return {
    ...seeded,
    relativePath,
    targetPath,
    created: true,
  };
}

function loadStudioProfile() {
  const relativePath = PROFILE_FILES[profile].studio;
  const targetPath = resolve(root, relativePath);
  if (existsSync(targetPath)) {
    return {
      contents: readFileSync(targetPath, "utf8"),
      relativePath,
      targetPath,
      created: false,
      source: relativePath,
    };
  }

  const seeded = seedFromExample("apps/content-studio/.env.example", [
    "apps/content-studio/.env.local",
  ]);
  return {
    ...seeded,
    relativePath,
    targetPath,
    created: true,
  };
}

function writeProfile(profileFile) {
  writeFileSync(profileFile.targetPath, profileFile.contents, { mode: 0o600 });
  chmodSync(profileFile.targetPath, 0o600);
  const action = profileFile.created
    ? "created"
    : "updated missing defaults in";
  const source =
    profileFile.created &&
    profileFile.source !== profileFile.relativePath &&
    !profileFile.source.endsWith(".env.example")
      ? ` (preserved values from ${profileFile.source})`
      : "";
  info(`${action} ${profileFile.relativePath}${source}`);
}

const app = loadAppProfile();
if (profile === "production" && app.created) {
  // The canonical example is convenient for local development, so it contains
  // localhost origins and illustrative sender copy. A production profile must
  // make the operator choose these values deliberately.
  app.contents = applyEnvValues(app.contents, {
    NEXT_PUBLIC_WEB_URL: "",
    NEXT_PUBLIC_ADMIN_WEB_URL: "",
    CONTENT_STUDIO_URL: "",
    BETTER_AUTH_URL: "",
    NEXT_PUBLIC_AUTH_BASE_URL: "",
    EMAIL_FROM: "",
  });
}
app.contents = prepareAppProfile(app.contents, profile, secret);

// The tracked product config is the reviewable default; environment values may
// override it only when a profile already made that choice explicitly.
const productConfig = JSON.parse(
  readFileSync(resolve(root, "saas.config.json"), "utf8"),
);
for (const [key, value, starterPlaceholder] of [
  ["NEXT_PUBLIC_APP_NAME", productConfig.product.name, "Your SaaS"],
  ["NEXT_PUBLIC_PROJECT_NAME", productConfig.product.slug, "your-saas"],
  ["NEXT_PUBLIC_DOCS_URL", productConfig.product.docsUrl ?? "", ""],
  [
    "NEXT_PUBLIC_DEFAULT_LOCALE",
    productConfig.internationalization.defaultLocale,
    "en",
  ],
  [
    "NEXT_PUBLIC_LOCALES",
    productConfig.internationalization.locales.join(","),
    "en,zh,es,fr,ja",
  ],
]) {
  const current = readEnvValue(app.contents, key);
  if (!current || current === starterPlaceholder) {
    app.contents = setEnvValue(app.contents, key, value);
  }
}

let studio = profile === "development" ? loadStudioProfile() : null;
if (studio) {
  studio.contents = prepareStudioProfile(studio.contents, profile, secret);
  const marketingSecret = readEnvValue(
    app.contents,
    "CONTENT_MARKETING_SECRET",
  );
  const studioMarketingSecret = readEnvValue(
    studio.contents,
    "CONTENT_MARKETING_SECRET",
  );
  studio.contents = setEnvValue(
    studio.contents,
    "CONTENT_MARKETING_SECRET",
    marketingSecret,
    {
      overwrite:
        studio.created ||
        studioMarketingSecret === "" ||
        isSetupPlaceholder(studioMarketingSecret),
    },
  );
  if (
    !studio.created &&
    studioMarketingSecret &&
    !isSetupPlaceholder(studioMarketingSecret) &&
    studioMarketingSecret !== marketingSecret
  ) {
    note(
      `${studio.relativePath} has a different CONTENT_MARKETING_SECRET; preserving it so you can rotate the shared credential deliberately`,
    );
  }
}

async function runGuidedPrompts() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = async (label, key, options = {}) => {
    const { secretValue = false, required = false } = options;
    const current = readEnvValue(app.contents, key);
    const hint = current
      ? secretValue
        ? " [set; Enter keeps it]"
        : ` [${current}]`
      : required
        ? " [required]"
        : " [optional]";

    let answer;
    if (secretValue && process.stdin.isTTY) {
      answer = await hiddenQuestion(rl, `${label}${hint}: `);
    } else {
      answer = await rl.question(`${label}${hint}: `);
    }

    const value = answer.trim() || current;
    app.contents = setEnvValue(app.contents, key, value);
  };

  const confirm = async (label, defaultYes = false) => {
    const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
    const answer = (await rl.question(`${label}${suffix}`))
      .trim()
      .toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  };

  try {
    heading("Product identity");
    await ask("Application name", "NEXT_PUBLIC_APP_NAME", { required: true });
    await ask("Project slug", "NEXT_PUBLIC_PROJECT_NAME", { required: true });
    await ask("Web URL", "NEXT_PUBLIC_WEB_URL", {
      required: profile === "production",
    });
    await ask("Admin URL", "NEXT_PUBLIC_ADMIN_WEB_URL", {
      required: profile === "production",
    });
    await ask("Content Studio URL", "CONTENT_STUDIO_URL");

    const webUrl = readEnvValue(app.contents, "NEXT_PUBLIC_WEB_URL");
    app.contents = setEnvValue(app.contents, "BETTER_AUTH_URL", webUrl);
    app.contents = setEnvValue(
      app.contents,
      "NEXT_PUBLIC_AUTH_BASE_URL",
      webUrl,
    );

    if (profile === "production") {
      heading("Production infrastructure");
      await ask("Pooled PostgreSQL URL", "DATABASE_URL", {
        secretValue: true,
        required: true,
      });
      await ask("TLS Redis URL", "RATE_LIMIT_REDIS_URL", {
        secretValue: true,
        required: true,
      });
      await ask("Trusted client-IP header", "RATE_LIMIT_IP_SOURCE", {
        required: true,
      });

      heading("Bot protection and email");
      await ask("Turnstile site key", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", {
        required: true,
      });
      await ask("Turnstile secret key", "TURNSTILE_SECRET_KEY", {
        secretValue: true,
        required: true,
      });
      await ask("Resend API key", "RESEND_API_KEY", {
        secretValue: true,
        required: true,
      });
      await ask("Email From value", "EMAIL_FROM", { required: true });

      heading("Stripe billing");
      await ask("Stripe private key", "STRIPE_PRIVATE_KEY", {
        secretValue: true,
        required: true,
      });
      await ask("Stripe webhook secret", "STRIPE_WEBHOOK_SECRET", {
        secretValue: true,
        required: true,
      });
      await ask(
        "Billing Portal configuration ID",
        "STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
        { required: true },
      );
      for (const [label, key] of [
        ["Plus monthly Price ID", "STRIPE_PRICE_PLUS_MONTHLY"],
        ["Plus yearly Price ID", "STRIPE_PRICE_PLUS_YEARLY"],
        ["Max monthly Price ID", "STRIPE_PRICE_MAX_MONTHLY"],
        ["Max yearly Price ID", "STRIPE_PRICE_MAX_YEARLY"],
      ]) {
        await ask(label, key, { required: true });
      }

      heading("Private object storage");
      await ask("Storage provider (s3/r2/minio)", "STORAGE_PROVIDER", {
        required: true,
      });
      await ask("Storage endpoint", "STORAGE_ENDPOINT");
      await ask("Storage region", "STORAGE_REGION", { required: true });
      await ask("Storage bucket", "STORAGE_BUCKET", { required: true });
      await ask("Storage access key", "STORAGE_ACCESS_KEY", {
        secretValue: true,
        required: true,
      });
      await ask("Storage secret key", "STORAGE_SECRET_KEY", {
        secretValue: true,
        required: true,
      });
    } else {
      heading("Optional development integrations");
      if (await confirm("Configure Google OAuth now?")) {
        await ask("Google client ID", "GOOGLE_CLIENT_ID");
        await ask("Google client secret", "GOOGLE_CLIENT_SECRET", {
          secretValue: true,
        });
      }
      if (await confirm("Configure Resend now?")) {
        await ask("Resend API key", "RESEND_API_KEY", { secretValue: true });
        await ask("Email From value", "EMAIL_FROM");
      }
      if (await confirm("Configure Stripe now?")) {
        await ask("Stripe private key", "STRIPE_PRIVATE_KEY", {
          secretValue: true,
        });
        await ask("Stripe webhook secret", "STRIPE_WEBHOOK_SECRET", {
          secretValue: true,
        });
      }
      if (await confirm("Configure object storage now?")) {
        await ask("Storage provider (s3/r2/minio)", "STORAGE_PROVIDER");
        await ask("Storage endpoint", "STORAGE_ENDPOINT");
        await ask("Storage region", "STORAGE_REGION");
        await ask("Storage bucket", "STORAGE_BUCKET");
        await ask("Storage access key", "STORAGE_ACCESS_KEY", {
          secretValue: true,
        });
        await ask("Storage secret key", "STORAGE_SECRET_KEY", {
          secretValue: true,
        });
      }
    }

    if (
      profile === "production" &&
      (await confirm("Configure Content Studio now?"))
    ) {
      studio = loadStudioProfile();
      if (studio.created) {
        studio.contents = applyEnvValues(studio.contents, {
          CONTENT_DATABASE_URL: "",
          CONTENT_STUDIO_URL: "",
          SAAS_MARKETING_API_URL: "",
          CONTENT_CORS_ORIGINS: "",
        });
      }
      studio.contents = prepareStudioProfile(studio.contents, profile, secret);

      const appMarketingSecret = readEnvValue(
        app.contents,
        "CONTENT_MARKETING_SECRET",
      );
      const studioMarketingSecret = readEnvValue(
        studio.contents,
        "CONTENT_MARKETING_SECRET",
      );
      const sharedMarketingSecret =
        appMarketingSecret ||
        (isSetupPlaceholder(studioMarketingSecret)
          ? ""
          : studioMarketingSecret) ||
        secret("hex");
      app.contents = setEnvValue(
        app.contents,
        "CONTENT_MARKETING_SECRET",
        sharedMarketingSecret,
        { overwrite: !appMarketingSecret },
      );
      studio.contents = setEnvValue(
        studio.contents,
        "CONTENT_MARKETING_SECRET",
        sharedMarketingSecret,
        {
          overwrite:
            studioMarketingSecret === "" ||
            isSetupPlaceholder(studioMarketingSecret),
        },
      );

      const studioAsk = async (label, key, options = {}) => {
        const current = readEnvValue(studio.contents, key);
        const { secretValue = false } = options;
        const hint = current
          ? secretValue
            ? " [set; Enter keeps it]"
            : ` [${current}]`
          : " [required]";
        let answer;
        if (secretValue && process.stdin.isTTY) {
          answer = await hiddenQuestion(rl, `${label}${hint}: `);
        } else {
          answer = await rl.question(`${label}${hint}: `);
        }
        studio.contents = setEnvValue(
          studio.contents,
          key,
          answer.trim() || current,
        );
      };

      heading("Content Studio");
      await studioAsk("Content database URL", "CONTENT_DATABASE_URL", {
        secretValue: true,
      });
      await studioAsk("Content Studio URL", "CONTENT_STUDIO_URL");
      await studioAsk("SaaS API URL", "SAAS_MARKETING_API_URL");
      await studioAsk("Allowed browser origins", "CONTENT_CORS_ORIGINS");
      app.contents = setEnvValue(
        app.contents,
        "CONTENT_STUDIO_URL",
        readEnvValue(studio.contents, "CONTENT_STUDIO_URL"),
      );
      await ask("Resend webhook signing secret", "RESEND_WEBHOOK_SECRET", {
        secretValue: true,
        required: true,
      });
    }
  } finally {
    rl.close();
  }
}

if (!nonInteractive) {
  await runGuidedPrompts();
}

heading(`${profile === "production" ? "Production" : "Development"} profile`);
writeProfile(app);
if (studio) writeProfile(studio);

if (profile === "development") {
  note(
    "provider credentials remain optional; blank services stay disabled locally",
  );
  console.log("\nNext: pnpm dev");
} else {
  note(
    "the production file is local and gitignored; transfer values to your host's secret manager",
  );
  note("production setup does not deploy or migrate a database");
  console.log("\nValidate before transfer: pnpm env:check:prod");
}
