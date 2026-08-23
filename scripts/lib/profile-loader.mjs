import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

export const DEVELOPMENT_APP_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];

export const DEVELOPMENT_STUDIO_FILES = [
  "apps/content-studio/.env.development.local",
  "apps/content-studio/.env.local",
];

export function readFirstProfile(root, candidates) {
  for (const relativePath of candidates) {
    const path = resolve(root, relativePath);
    if (!existsSync(path)) continue;
    return {
      path,
      relativePath,
      values: parse(readFileSync(path)),
    };
  }

  return null;
}

/** Load a profile while keeping explicitly exported shell values authoritative. */
export function loadDevelopmentAppProfile(root) {
  const profile = readFirstProfile(root, DEVELOPMENT_APP_FILES);
  if (!profile) return null;

  const shellEnv = new Map(Object.entries(process.env));
  Object.assign(process.env, profile.values);
  for (const [key, value] of shellEnv) process.env[key] = value;
  Object.assign(process.env, { NODE_ENV: "development" });

  return profile;
}
