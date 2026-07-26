import { config as loadEnvFile } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const adminDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(adminDir, "../..");

/**
 * Loaded by absolute path rather than `import "../../src/..."`.
 *
 * Next compiles this file to `next.config.compiled.js` and inlines only the
 * imports that live inside *this app's* root, so a relative import reaching up
 * into the repo's `src/` survives as a bare require that then fails to resolve.
 * Same reason the dotenv paths above are absolute.
 */
const { securityHeadersRoute } = createRequire(import.meta.url)(
  path.join(rootDir, "src/config/security-headers.js")
) as typeof import("../../src/config/security-headers.js");
const initialEnv = new Map(Object.entries(process.env));
const nodeEnv = process.env.NODE_ENV ?? "development";

for (const fileName of [
  ".env",
  `.env.${nodeEnv}`,
  ".env.local",
  `.env.${nodeEnv}.local`,
]) {
  loadEnvFile({ path: path.join(rootDir, fileName), override: true });
}

for (const [key, value] of initialEnv) {
  process.env[key] = value;
}

const adminWebUrl =
  process.env.NEXT_PUBLIC_ADMIN_WEB_URL ??
  (nodeEnv === "development" ? "http://localhost:3001" : undefined);

if (adminWebUrl) {
  if (!initialEnv.has("BETTER_AUTH_URL")) {
    process.env.BETTER_AUTH_URL = adminWebUrl;
  }
  if (!initialEnv.has("NEXT_PUBLIC_AUTH_BASE_URL")) {
    process.env.NEXT_PUBLIC_AUTH_BASE_URL = adminWebUrl;
  }
}

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["sonner"],
  },
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  async headers() {
    // The admin console runs no analytics and no ads, so it gets the tighter
    // policy for free — the vendor hosts are only added when their env vars are
    // set, and this app never sets them.
    return [
      securityHeadersRoute({
        analyticsId: undefined,
        adsenseCode: undefined,
      }),
    ];
  },
};

export default nextConfig;
