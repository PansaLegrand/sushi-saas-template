import rawProductConfig from "../../saas.config.json";

export const productStylePresets = [
  "studio",
  "glass",
  "soft",
  "editorial",
  "brutalist",
] as const;
export const productLocales = ["en", "zh", "es", "fr", "ja"] as const;

export type ProductStylePreset = (typeof productStylePresets)[number];
export type ProductLocale = (typeof productLocales)[number];
export type ProductConfig = {
  schemaVersion: 1;
  product: {
    name: string;
    slug: string;
    supportEmail: string | null;
    docsUrl: string | null;
  };
  appearance: { preset: ProductStylePreset };
  internationalization: {
    defaultLocale: ProductLocale;
    locales: ProductLocale[];
  };
  legal: {
    entityName: string | null;
    entityAddress: string | null;
    privacyContactEmail: string | null;
    legalContactEmail: string | null;
    governingLaw: string | null;
    effectiveDate: string;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path}${key} is not a supported configuration key`);
}

function validEmail(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  );
}

function validUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validOptionalText(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      value.length >= 1 &&
      value.length <= 500)
  );
}

function validIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function getProductConfigSchemaIssues(input: unknown): string[] {
  const issues: string[] = [];
  const root = record(input);
  if (!root) return ["configuration must be a JSON object"];
  issues.push(
    ...unknownKeys(
      root,
      [
        "schemaVersion",
        "product",
        "appearance",
        "internationalization",
        "legal",
      ],
      "",
    ),
  );
  if (root.schemaVersion !== 1) issues.push("schemaVersion must equal 1");

  const product = record(root.product);
  if (!product) {
    issues.push("product must be an object");
  } else {
    issues.push(
      ...unknownKeys(
        product,
        ["name", "slug", "supportEmail", "docsUrl"],
        "product.",
      ),
    );
    if (
      typeof product.name !== "string" ||
      product.name !== product.name.trim() ||
      product.name.length < 1 ||
      product.name.length > 80
    ) {
      issues.push("product.name must contain 1-80 trimmed characters");
    }
    if (
      typeof product.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) ||
      product.slug.length < 2 ||
      product.slug.length > 63
    ) {
      issues.push("product.slug must be a 2-63 character lowercase kebab slug");
    }
    if (!validEmail(product.supportEmail)) {
      issues.push("product.supportEmail must be an email or null");
    }
    if (!validUrl(product.docsUrl)) {
      issues.push("product.docsUrl must be an HTTP(S) URL or null");
    }
  }

  const appearance = record(root.appearance);
  if (
    !appearance ||
    !productStylePresets.includes(appearance.preset as ProductStylePreset)
  ) {
    issues.push(
      `appearance.preset must be one of ${productStylePresets.join(", ")}`,
    );
  } else {
    issues.push(...unknownKeys(appearance, ["preset"], "appearance."));
  }

  const internationalization = record(root.internationalization);
  if (!internationalization) {
    issues.push("internationalization must be an object");
  } else {
    issues.push(
      ...unknownKeys(
        internationalization,
        ["defaultLocale", "locales"],
        "internationalization.",
      ),
    );
    const defaultLocale = internationalization.defaultLocale;
    const locales = internationalization.locales;
    if (!productLocales.includes(defaultLocale as ProductLocale)) {
      issues.push(
        `internationalization.defaultLocale must be one of ${productLocales.join(", ")}`,
      );
    }
    if (
      !Array.isArray(locales) ||
      locales.length === 0 ||
      locales.some(
        (locale) => !productLocales.includes(locale as ProductLocale),
      )
    ) {
      issues.push(
        "internationalization.locales must contain supported locales",
      );
    } else {
      if (new Set(locales).size !== locales.length) {
        issues.push("internationalization.locales must not contain duplicates");
      }
      if (!locales.includes(defaultLocale)) {
        issues.push("internationalization.defaultLocale must also be enabled");
      }
    }
  }

  const legal = record(root.legal);
  if (!legal) {
    issues.push("legal must be an object");
  } else {
    issues.push(
      ...unknownKeys(
        legal,
        [
          "entityName",
          "entityAddress",
          "privacyContactEmail",
          "legalContactEmail",
          "governingLaw",
          "effectiveDate",
        ],
        "legal.",
      ),
    );
    for (const key of [
      "entityName",
      "entityAddress",
      "governingLaw",
    ] as const) {
      if (!validOptionalText(legal[key])) {
        issues.push(`legal.${key} must be 1-500 trimmed characters or null`);
      }
    }
    for (const key of ["privacyContactEmail", "legalContactEmail"] as const) {
      if (!validEmail(legal[key])) {
        issues.push(`legal.${key} must be an email or null`);
      }
    }
    if (!validIsoCalendarDate(legal.effectiveDate)) {
      issues.push("legal.effectiveDate must be a real YYYY-MM-DD date");
    }
  }
  return issues;
}

export function parseProductConfig(input: unknown): ProductConfig {
  const issues = getProductConfigSchemaIssues(input);
  if (issues.length > 0) {
    throw new Error(`Invalid saas.config.json:\n- ${issues.join("\n- ")}`);
  }
  return structuredClone(input) as ProductConfig;
}

export const productConfig = parseProductConfig(rawProductConfig);

export function runtimeProductName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || productConfig.product.name;
}

export function runtimeProductSlug(): string {
  return (
    process.env.NEXT_PUBLIC_PROJECT_NAME?.trim() || productConfig.product.slug
  );
}

export function runtimeDocsUrl(): string | null {
  return (
    process.env.NEXT_PUBLIC_DOCS_URL?.trim() || productConfig.product.docsUrl
  );
}

export type ProductConfigCheckOptions = {
  production?: boolean;
  environment?: Record<string, string | undefined>;
};

/** Pure launch/consistency checks used by the CLI and unit tests. */
export function getProductConfigIssues(
  config: ProductConfig,
  options: ProductConfigCheckOptions = {},
): string[] {
  const issues: string[] = [];
  if (options.production) {
    if (config.product.name === "Your SaaS") {
      issues.push("product.name is still the neutral starter placeholder");
    }
    if (config.product.slug === "your-saas") {
      issues.push("product.slug is still the neutral starter placeholder");
    }
    if (!config.product.supportEmail) {
      issues.push("product.supportEmail is required before launch");
    }
    for (const key of [
      "entityName",
      "entityAddress",
      "privacyContactEmail",
      "legalContactEmail",
      "governingLaw",
    ] as const) {
      if (!config.legal[key]) {
        issues.push(`legal.${key} is required before launch`);
      }
    }
  }

  const environment = options.environment ?? {};
  const expected: Record<string, string | null> = {
    NEXT_PUBLIC_APP_NAME: config.product.name,
    NEXT_PUBLIC_PROJECT_NAME: config.product.slug,
    NEXT_PUBLIC_DOCS_URL: config.product.docsUrl,
    NEXT_PUBLIC_DEFAULT_LOCALE: config.internationalization.defaultLocale,
    NEXT_PUBLIC_LOCALES: config.internationalization.locales.join(","),
  };
  for (const [key, configured] of Object.entries(expected)) {
    const deployed = environment[key]?.trim();
    if (deployed && deployed !== (configured ?? "")) {
      issues.push(`${key} disagrees with saas.config.json`);
    }
  }
  return issues;
}
