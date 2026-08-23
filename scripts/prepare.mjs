import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync(".git")) {
  console.log("No Git checkout detected; skipping Husky hook installation.");
  process.exit(0);
}

const result = spawnSync("husky", { stdio: "inherit", shell: true });
if (result.error) {
  console.error(`Could not install Husky hooks: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
