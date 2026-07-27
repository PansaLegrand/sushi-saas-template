import { afterEach, describe, expect, it, vi } from "vitest";

async function loadLocaleConfig({
  defaultLocale = "",
  locales = "",
}: {
  defaultLocale?: string;
  locales?: string;
} = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_LOCALE", defaultLocale);
  vi.stubEnv("NEXT_PUBLIC_LOCALES", locales);

  return import("@/i18n/locale");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("locale paths", () => {
  it("enables every shipped locale by default", async () => {
    const { availableLocales, locales } = await loadLocaleConfig();

    expect(locales).toEqual([...availableLocales]);
  });

  it("omits the default locale from public URLs", async () => {
    const { localePath } = await loadLocaleConfig();

    expect(localePath("en")).toBe("/");
    expect(localePath("en", "/blogs/blog-one")).toBe("/blogs/blog-one");
    expect(localePath("en", "account/billing")).toBe("/account/billing");
  });

  it("keeps non-default locale prefixes", async () => {
    const { localePath } = await loadLocaleConfig();

    expect(localePath("zh", "/blogs/blog-one")).toBe("/zh/blogs/blog-one");
    expect(localePath("es", "pricing")).toBe("/es/pricing");
  });

  it("normalizes regional locale codes", async () => {
    const { localePath, normalizeLocale } = await loadLocaleConfig();

    expect(normalizeLocale("zh-CN")).toBe("zh");
    expect(localePath("zh-CN", "/docs")).toBe("/zh/docs");
  });

  it("builds absolute URLs with the same prefix rules", async () => {
    const { absoluteLocaleUrl } = await loadLocaleConfig();

    expect(absoluteLocaleUrl("https://example.com", "en")).toBe("https://example.com");
    expect(absoluteLocaleUrl("https://example.com", "en", "/reserve?success=1")).toBe(
      "https://example.com/reserve?success=1"
    );
    expect(absoluteLocaleUrl("https://example.com", "fr", "/reserve?success=1")).toBe(
      "https://example.com/fr/reserve?success=1"
    );
  });

  it("treats protocol-relative input as a local path", async () => {
    const { absoluteLocaleUrl } = await loadLocaleConfig();

    expect(absoluteLocaleUrl("https://example.com", "en", "//not-external.test/path")).toBe(
      "https://example.com/not-external.test/path"
    );
  });

  it("can expose English only without deleting other translations", async () => {
    const { isEnabledLocale, localePath, locales, normalizeLocale } = await loadLocaleConfig({
      locales: "en",
    });

    expect(locales).toEqual(["en"]);
    expect(isEnabledLocale("es")).toBe(false);
    expect(normalizeLocale("es")).toBe("en");
    expect(localePath("es", "/pricing")).toBe("/pricing");
  });

  it("can expose English and Spanish only", async () => {
    const { isEnabledLocale, localePath, locales } = await loadLocaleConfig({
      locales: "en,es",
    });

    expect(locales).toEqual(["en", "es"]);
    expect(isEnabledLocale("es")).toBe(true);
    expect(isEnabledLocale("zh")).toBe(false);
    expect(localePath("es", "/pricing")).toBe("/es/pricing");
    expect(localePath("zh", "/pricing")).toBe("/pricing");
  });

  it("can change the default locale while keeping enabled languages explicit", async () => {
    const { defaultLocale, localePath, locales } = await loadLocaleConfig({
      defaultLocale: "es",
      locales: "en",
    });

    expect(defaultLocale).toBe("es");
    expect(locales).toEqual(["es", "en"]);
    expect(localePath("es", "/pricing")).toBe("/pricing");
    expect(localePath("en", "/pricing")).toBe("/en/pricing");
  });
});
