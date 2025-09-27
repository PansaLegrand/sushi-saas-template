import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@/app": path.resolve(__dirname, "src/app"),
    },
  },
});

