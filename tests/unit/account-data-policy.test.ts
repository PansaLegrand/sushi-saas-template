/**
 * Privacy inventory drift test.
 *
 * A table added without an export/erasure classification is how personal data
 * becomes invisible to an otherwise well-tested deletion worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACCOUNT_DATA_POLICY } from "@/config/account-data-policy";

describe("account data policy inventory", () => {
  it("classifies every SQL table and no retired table", () => {
    const schema = readFileSync(
      join(process.cwd(), "src/db/schema.ts"),
      "utf8",
    );
    const tables = [...schema.matchAll(/\bpgTable\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );

    expect(Object.keys(ACCOUNT_DATA_POLICY).sort()).toEqual(
      [...new Set(tables)].sort(),
    );
  });

  it("documents why retained data is retained", () => {
    for (const [table, policy] of Object.entries(ACCOUNT_DATA_POLICY)) {
      expect(policy.rationale, table).not.toHaveLength(0);
    }
  });
});
