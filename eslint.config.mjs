import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Next 15 still exports legacy presets. Keep this bridge until the app moves
// to Next 16; the lint command itself uses ESLint's supported CLI now.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
export default [
  { ignores: ["**/.next/**", "**/node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", "apps/content-studio/**", "**/next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    settings: { next: { rootDir: [".", "apps/admin"] } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-img-element": "off",
      "prefer-const": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
