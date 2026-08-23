import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Match Next's precedence while preserving values explicitly supplied by the
// shell. This makes the CLI use the same environment-specific profile as the
// application instead of silently preferring a legacy .env file.
const initialEnv = new Map(Object.entries(process.env));
const nodeEnv = process.env.NODE_ENV ?? "development";
const files = [
  ".env",
  `.env.${nodeEnv}`,
  ...(nodeEnv === "test" ? [] : [".env.local"]),
  `.env.${nodeEnv}.local`,
];

for (const path of files) config({ path, override: true });
for (const [key, value] of initialEnv) process.env[key] = value;

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
