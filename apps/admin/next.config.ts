import { config as loadEnvFile } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adminDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(adminDir, "../..");
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
};

export default nextConfig;
