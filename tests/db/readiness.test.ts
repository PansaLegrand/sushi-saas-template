import { expect, it } from "vitest";

import { REQUIRED_MIGRATION_COUNT } from "@/db/migration-manifest";
import { checkDatabaseReadiness } from "@/models/readiness";

import { describeDb, useCleanDatabase } from "./setup";

describeDb("database readiness (real database)", () => {
  useCleanDatabase();

  it("proves connectivity and the release's complete migration lineage", async () => {
    await expect(checkDatabaseReadiness()).resolves.toEqual({
      migrationsApplied: expect.any(Number),
    });

    expect(
      (await checkDatabaseReadiness()).migrationsApplied,
    ).toBeGreaterThanOrEqual(REQUIRED_MIGRATION_COUNT);
  });
});
