import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

/** Explicit empty values opt out; never fall back to another database silently. */
export function readTestInfrastructureUrls(root, environment) {
  const result = {};
  const keys = ["TEST_DATABASE_URL", "TEST_REDIS_URL"];
  for (const key of keys) if (Object.hasOwn(environment, key)) result[key] = environment[key] ?? "";
  for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const values = parse(readFileSync(path));
    for (const key of keys) {
      if (Object.hasOwn(result, key)) continue;
      if (values[key]?.trim()) result[key] = values[key].trim();
    }
  }
  return result;
}
