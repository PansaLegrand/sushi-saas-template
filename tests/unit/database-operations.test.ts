import { describe, expect, it } from "vitest";

import {
  databaseConnectionParts,
  inspectRestoreTarget,
  parsePostgresUrl,
  safeBackupLabel,
} from "../../scripts/lib/database-operations.mjs";

describe("database operation safety", () => {
  it("requires an unmistakable scratch name and exact confirmation", () => {
    expect(
      inspectRestoreTarget(
        "postgresql://user:secret@db.example.com/product_restore_drill",
        "product_restore_drill",
      ),
    ).toEqual({
      ok: true,
      database: "product_restore_drill",
      reasons: [],
    });

    expect(
      inspectRestoreTarget(
        "postgresql://user:secret@db.example.com/product_restore_drill",
        "product_restore",
      ).ok,
    ).toBe(false);
    expect(
      inspectRestoreTarget(
        "postgresql://user:secret@db.example.com/production",
        "production",
      ).reasons,
    ).toContain("database name must contain restore, scratch, or drill");
  });

  it("always protects the bundled application databases", () => {
    for (const database of ["sushi_dev", "sushi_test", "sushi_content"]) {
      const result = inspectRestoreTarget(
        `postgresql://sushi:sushi@localhost:5432/${database}`,
        database,
      );
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain(
        `${database} is a protected application database`,
      );
    }
  });

  it("keeps passwords out of child-process connection arguments", () => {
    const parts = databaseConnectionParts(
      "postgresql://user:p%40ssword@db.example.com:5433/app",
    );

    expect(parts.password).toBe("p@ssword");
    expect(parts.safeUrl).not.toContain("p%40ssword");
    expect(parts.safeUrl).not.toContain("p@ssword");
    expect(parts.database).toBe("app");
    expect(parsePostgresUrl("https://example.com/app")).toBeNull();
  });

  it("normalizes operator labels into bounded filenames", () => {
    expect(safeBackupLabel(" Production / EU West ")).toBe(
      "production-eu-west",
    );
    expect(safeBackupLabel("***")).toBe("database");
    expect(safeBackupLabel("a".repeat(100))).toHaveLength(64);
  });
});
