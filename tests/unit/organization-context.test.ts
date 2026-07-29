import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeOrganizationSlug } from "@/config/organization-context";

describe("organization context transport", () => {
  it("accepts application-defined slugs and rejects unsafe header values", () => {
    expect(normalizeOrganizationSlug(" acme.team_2 ")).toBe("acme.team_2");
    expect(normalizeOrganizationSlug("")).toBeNull();
    expect(normalizeOrganizationSlug(`acme\nx-forwarded-for: attacker`)).toBeNull();
    expect(normalizeOrganizationSlug("x".repeat(256))).toBeNull();
  });

  it("keeps every browser tenant client on the per-tab organization header", () => {
    const clients = [
      "checkout.ts",
      "credits.ts",
      "plan.ts",
      "reservations.ts",
      "storage.ts",
      "tasks.ts",
      "team.ts",
    ];

    for (const file of clients) {
      const source = fs.readFileSync(
        path.join(process.cwd(), "src", "api", file),
        "utf8"
      );
      expect(source, file).toContain("organizationHeaders");
    }
  });
});
