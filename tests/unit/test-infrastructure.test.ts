/** An explicit test opt-out must not reconnect to a URL from a developer profile. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readTestInfrastructureUrls } from "../../scripts/lib/test-infrastructure.mjs";

it("honors explicit values including empty strings, and reads only test URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "sushi-test-infra-"));
  try {
    writeFileSync(join(root, ".env"), "TEST_DATABASE_URL=postgresql://legacy/test\nTEST_REDIS_URL=redis://legacy\nPRIVATE_KEY=never-load\n");
    writeFileSync(join(root, ".env.development.local"), "TEST_DATABASE_URL=postgresql://preferred/test\n");
    expect(readTestInfrastructureUrls(root, {})).toEqual({ TEST_DATABASE_URL: "postgresql://preferred/test", TEST_REDIS_URL: "redis://legacy" });
    expect(readTestInfrastructureUrls(root, { TEST_DATABASE_URL: "", TEST_REDIS_URL: "" })).toEqual({ TEST_DATABASE_URL: "", TEST_REDIS_URL: "" });
    expect(readTestInfrastructureUrls(root, { TEST_DATABASE_URL: "postgresql://explicit/test" })).toEqual({ TEST_DATABASE_URL: "postgresql://explicit/test", TEST_REDIS_URL: "redis://legacy" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
