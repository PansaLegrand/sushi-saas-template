import createNextIntlPlugin from "next-intl/plugin";
import { createMDX as createFumadocsMDX } from "fumadocs-mdx/next";
import { securityHeadersRoute } from "./src/config/security-headers.js";
import { defaultLocale, locales } from "./src/i18n/locale";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Slugs that moved from the blog collection to the docs collection when the
 * two were split. These URLs are indexed and linked externally, so they keep
 * working permanently rather than 404ing.
 */
const MOVED_TO_DOCS = [
  "quick-start",
  "database-setup",
  "authentication-and-admin",
  "stripe-setup",
  "notifications-slack",
  "storage-uploads",
  "logging",
  "email-service",
  "account-ledger",
  "text-to-video-tasks",
  "reservations-feature",
];

const nextConfig = {
  experimental: {
    optimizePackageImports: ["sonner"],
  },
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  async headers() {
    return [securityHeadersRoute()];
  },
  async redirects() {
    return MOVED_TO_DOCS.flatMap((slug) => [
      // Locale-prefixed legacy links, e.g. /en/blogs/quick-start.
      ...locales.map((locale) => ({
        source: `/${locale}/blogs/${slug}`,
        destination:
          locale === defaultLocale
            ? `/docs/${slug}`
            : `/${locale}/docs/${slug}`,
        permanent: true,
      })),
      // Unprefixed, in case anything links without a locale
      {
        source: `/blogs/${slug}`,
        destination: `/docs/${slug}`,
        permanent: true,
      },
    ]);
  },
};

const withFuma = createFumadocsMDX();
export default withFuma(withNextIntl(nextConfig));
