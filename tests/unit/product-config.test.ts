import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProductConfigIssues,
  parseProductConfig,
  productConfig,
  runtimeDocsUrl,
  runtimeProductName,
  runtimeProductSlug,
} from "@/config/product";

afterEach(() => vi.unstubAllEnvs());

describe("tracked product configuration", () => {
  it("keeps the committed starter configuration schema-valid", () => {
    expect(parseProductConfig(productConfig)).toEqual(productConfig);
  });

  it("rejects invalid slugs, duplicate locales, and a disabled default", () => {
    expect(() =>
      parseProductConfig({
        ...productConfig,
        product: { ...productConfig.product, slug: "Not A Slug" },
      }),
    ).toThrow();
    expect(() =>
      parseProductConfig({
        ...productConfig,
        product: { ...productConfig.product, suportEmail: "typo@example.com" },
      }),
    ).toThrow(/suportEmail is not a supported/);
    expect(() =>
      parseProductConfig({
        ...productConfig,
        legal: { ...productConfig.legal, effectiveDate: "2026-02-30" },
      }),
    ).toThrow();
    expect(() =>
      parseProductConfig({
        ...productConfig,
        internationalization: {
          defaultLocale: "es",
          locales: ["en", "en"],
        },
      }),
    ).toThrow();
  });

  it("makes neutral and incomplete launch identity fail the production gate", () => {
    expect(getProductConfigIssues(productConfig, { production: true })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("product.name"),
        expect.stringContaining("product.slug"),
        expect.stringContaining("supportEmail"),
        expect.stringContaining("legal.entityName"),
      ]),
    );
  });

  it("detects public environment values that contradict the tracked config", () => {
    expect(
      getProductConfigIssues(productConfig, {
        environment: {
          NEXT_PUBLIC_APP_NAME: "A different product",
          NEXT_PUBLIC_LOCALES: "en,es",
        },
      }),
    ).toEqual([
      "NEXT_PUBLIC_APP_NAME disagrees with saas.config.json",
      "NEXT_PUBLIC_LOCALES disagrees with saas.config.json",
    ]);
  });

  it("accepts a complete, environment-consistent launch identity", () => {
    const ready = parseProductConfig({
      ...productConfig,
      product: {
        name: "Acme Cloud",
        slug: "acme-cloud",
        supportEmail: "support@acme.test",
        docsUrl: "https://docs.acme.test",
      },
      legal: {
        entityName: "Acme Cloud Ltd",
        entityAddress: "1 Example Street",
        privacyContactEmail: "privacy@acme.test",
        legalContactEmail: "legal@acme.test",
        governingLaw: "The laws and courts of Example",
        effectiveDate: "2026-08-24",
      },
    });

    expect(
      getProductConfigIssues(ready, {
        production: true,
        environment: {
          NEXT_PUBLIC_APP_NAME: "Acme Cloud",
          NEXT_PUBLIC_PROJECT_NAME: "acme-cloud",
          NEXT_PUBLIC_DOCS_URL: "https://docs.acme.test",
          NEXT_PUBLIC_DEFAULT_LOCALE: "en",
          NEXT_PUBLIC_LOCALES: "en,zh,es,fr,ja",
        },
      }),
    ).toEqual([]);
  });

  it("allows explicit deployment overrides through one set of helpers", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Runtime Name");
    vi.stubEnv("NEXT_PUBLIC_PROJECT_NAME", "runtime-slug");
    vi.stubEnv("NEXT_PUBLIC_DOCS_URL", "https://docs.example.test");

    expect(runtimeProductName()).toBe("Runtime Name");
    expect(runtimeProductSlug()).toBe("runtime-slug");
    expect(runtimeDocsUrl()).toBe("https://docs.example.test");
  });
});
