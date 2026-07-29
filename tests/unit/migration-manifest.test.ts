/**
 * Readiness must reject an artifact deployed before its migrations while still
 * allowing the database-first half of an expand/contract deployment.
 */
import { describe, expect, it } from "vitest";

import {
  hasRequiredMigrations,
  REQUIRED_MIGRATION_COUNT,
  REQUIRED_MIGRATION_MARKERS,
} from "@/db/migration-manifest";

describe("migration readiness manifest", () => {
  it("contains a marker for every journal entry", () => {
    expect(REQUIRED_MIGRATION_COUNT).toBeGreaterThan(0);
    expect(REQUIRED_MIGRATION_MARKERS).toHaveLength(REQUIRED_MIGRATION_COUNT);
    expect(new Set(REQUIRED_MIGRATION_MARKERS).size).toBe(
      REQUIRED_MIGRATION_COUNT,
    );
    expect(REQUIRED_MIGRATION_MARKERS).toEqual(
      [...REQUIRED_MIGRATION_MARKERS].sort((left, right) => left - right),
    );
  });

  it("accepts the exact migration set", () => {
    expect(
      hasRequiredMigrations({
        applied: REQUIRED_MIGRATION_COUNT,
        requiredApplied: REQUIRED_MIGRATION_COUNT,
      }),
    ).toBe(true);
  });

  it("accepts a database that is ahead but retains every required marker", () => {
    expect(
      hasRequiredMigrations({
        applied: REQUIRED_MIGRATION_COUNT + 1,
        requiredApplied: REQUIRED_MIGRATION_COUNT,
      }),
    ).toBe(true);
  });

  it("rejects pending or divergent migration histories", () => {
    expect(
      hasRequiredMigrations({
        applied: REQUIRED_MIGRATION_COUNT - 1,
        requiredApplied: REQUIRED_MIGRATION_COUNT - 1,
      }),
    ).toBe(false);
    expect(
      hasRequiredMigrations({
        applied: REQUIRED_MIGRATION_COUNT,
        requiredApplied: REQUIRED_MIGRATION_COUNT - 1,
      }),
    ).toBe(false);
  });
});
