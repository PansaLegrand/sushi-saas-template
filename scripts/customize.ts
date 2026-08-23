#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  parseProductConfig,
  productConfig,
  productLocales,
  productStylePresets,
  type ProductConfig,
} from "@/config/product";
import { setEnvValue } from "./lib/env-profile.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "saas.config.json");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flagsWithValues = new Set([
  "--name",
  "--slug",
  "--preset",
  "--locales",
  "--default-locale",
  "--support-email",
  "--docs-url",
  "--entity-name",
  "--entity-address",
  "--privacy-email",
  "--legal-email",
  "--governing-law",
  "--effective-date",
]);
const booleanFlags = new Set(["--yes", "--dry-run", "--no-env"]);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm customize
       pnpm customize -- --name "Acme" --slug acme --preset glass \\
         --locales en,es --default-locale en --support-email help@acme.test --yes

Writes the tracked saas.config.json and synchronizes matching public values into
existing ignored environment profiles. Use "none" to clear an optional URL or
email, --no-env to skip profile sync, or --dry-run to preview without writing.`);
  process.exit(0);
}

const values = new Map<string, string>();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (booleanFlags.has(arg)) continue;
  if (!flagsWithValues.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${arg} requires a value.`);
    process.exit(1);
  }
  values.set(arg, value);
  index += 1;
}

function optionalValue(value: string | undefined, current: string | null) {
  if (value === undefined) return current;
  return ["none", "null", "-"].includes(value.trim().toLowerCase())
    ? null
    : value.trim();
}

function applyFlags(config: ProductConfig): ProductConfig {
  const next = structuredClone(config);
  if (values.has("--name")) next.product.name = values.get("--name")!.trim();
  if (values.has("--slug")) next.product.slug = values.get("--slug")!.trim();
  if (values.has("--preset")) {
    next.appearance.preset = values
      .get("--preset")!
      .trim() as ProductConfig["appearance"]["preset"];
  }
  if (values.has("--locales")) {
    next.internationalization.locales = values
      .get("--locales")!
      .split(",")
      .map((locale) => locale.trim())
      .filter(Boolean) as ProductConfig["internationalization"]["locales"];
  }
  if (values.has("--default-locale")) {
    next.internationalization.defaultLocale = values
      .get("--default-locale")!
      .trim() as ProductConfig["internationalization"]["defaultLocale"];
  }
  next.product.supportEmail = optionalValue(
    values.get("--support-email"),
    next.product.supportEmail,
  );
  next.product.docsUrl = optionalValue(
    values.get("--docs-url"),
    next.product.docsUrl,
  );
  next.legal.entityName = optionalValue(
    values.get("--entity-name"),
    next.legal.entityName,
  );
  next.legal.entityAddress = optionalValue(
    values.get("--entity-address"),
    next.legal.entityAddress,
  );
  next.legal.privacyContactEmail = optionalValue(
    values.get("--privacy-email"),
    next.legal.privacyContactEmail,
  );
  next.legal.legalContactEmail = optionalValue(
    values.get("--legal-email"),
    next.legal.legalContactEmail,
  );
  next.legal.governingLaw = optionalValue(
    values.get("--governing-law"),
    next.legal.governingLaw,
  );
  if (values.has("--effective-date")) {
    next.legal.effectiveDate = values.get("--effective-date")!.trim();
  }
  return parseProductConfig(next);
}

async function interactiveConfig(
  config: ProductConfig,
): Promise<ProductConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label: string, current: string | null) => {
    const answer = (
      await rl.question(`${label} [${current ?? "none"}] ("-" clears): `)
    ).trim();
    if (!answer) return current;
    return optionalValue(answer, current);
  };

  try {
    const next = structuredClone(config);
    next.product.name =
      (await ask("Product name", next.product.name)) ?? next.product.name;
    next.product.slug =
      (await ask("Product slug", next.product.slug)) ?? next.product.slug;
    next.appearance.preset =
      ((await ask(
        `Style preset (${productStylePresets.join("/")})`,
        next.appearance.preset,
      )) as ProductConfig["appearance"]["preset"]) ?? next.appearance.preset;
    const locales = await ask(
      `Enabled locales (${productLocales.join(",")})`,
      next.internationalization.locales.join(","),
    );
    if (locales) {
      next.internationalization.locales = locales
        .split(",")
        .map((locale) =>
          locale.trim(),
        ) as ProductConfig["internationalization"]["locales"];
    }
    next.internationalization.defaultLocale =
      ((await ask(
        "Default locale",
        next.internationalization.defaultLocale,
      )) as ProductConfig["internationalization"]["defaultLocale"]) ??
      next.internationalization.defaultLocale;
    next.product.supportEmail = await ask(
      "Support email",
      next.product.supportEmail,
    );
    next.product.docsUrl = await ask("External docs URL", next.product.docsUrl);

    const legal = (
      await rl.question("Configure public legal identity now? [y/N]: ")
    )
      .trim()
      .toLowerCase();
    if (["y", "yes"].includes(legal)) {
      next.legal.entityName = await ask("Legal entity", next.legal.entityName);
      next.legal.entityAddress = await ask(
        "Registered address",
        next.legal.entityAddress,
      );
      next.legal.privacyContactEmail = await ask(
        "Privacy email",
        next.legal.privacyContactEmail,
      );
      next.legal.legalContactEmail = await ask(
        "Legal notices email",
        next.legal.legalContactEmail,
      );
      next.legal.governingLaw = await ask(
        "Governing law and forum",
        next.legal.governingLaw,
      );
      next.legal.effectiveDate =
        (await ask("Legal effective date", next.legal.effectiveDate)) ??
        next.legal.effectiveDate;
    }
    const parsed = parseProductConfig(next);
    const confirmation = (
      await rl.question('Type "apply" to write this configuration: ')
    )
      .trim()
      .toLowerCase();
    if (confirmation !== "apply") throw new Error("Customization canceled.");
    return parsed;
  } finally {
    rl.close();
  }
}

function syncProfiles(config: ProductConfig) {
  const publicValues = {
    NEXT_PUBLIC_APP_NAME: config.product.name,
    NEXT_PUBLIC_PROJECT_NAME: config.product.slug,
    NEXT_PUBLIC_DOCS_URL: config.product.docsUrl ?? "",
    NEXT_PUBLIC_DEFAULT_LOCALE: config.internationalization.defaultLocale,
    NEXT_PUBLIC_LOCALES: config.internationalization.locales.join(","),
  };
  const updated: string[] = [];
  for (const relativePath of [
    ".env.development.local",
    ".env.local",
    ".env",
    ".env.production.local",
  ]) {
    const path = resolve(root, relativePath);
    if (!existsSync(path)) continue;
    let contents = readFileSync(path, "utf8");
    for (const [key, value] of Object.entries(publicValues)) {
      contents = setEnvValue(contents, key, value);
    }
    writeFileSync(path, contents, { mode: 0o600 });
    updated.push(relativePath);
  }
  return updated;
}

async function main() {
  const interactive = values.size === 0 && process.stdin.isTTY;
  if (!interactive && !args.includes("--yes") && !args.includes("--dry-run")) {
    throw new Error(
      "Non-interactive customization requires --yes or --dry-run.",
    );
  }
  const next = interactive
    ? await interactiveConfig(productConfig)
    : applyFlags(productConfig);
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  console.log(serialized);
  if (args.includes("--dry-run")) {
    console.log("Dry run only; no files changed.");
    return;
  }

  const temporaryPath = resolve(root, `.saas.config.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryPath, serialized, { mode: 0o644, flag: "wx" });
    renameSync(temporaryPath, configPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  const profiles = args.includes("--no-env") ? [] : syncProfiles(next);
  console.log(
    `Updated saas.config.json${profiles.length ? ` and ${profiles.join(", ")}` : ""}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
