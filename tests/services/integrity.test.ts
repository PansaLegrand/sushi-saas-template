import { describe, expect, it, vi } from "vitest";

const listDataIntegrityFindings = vi.hoisted(() => vi.fn());
vi.mock("@/models/integrity", () => ({ listDataIntegrityFindings }));

import { checkDataIntegrity } from "@/services/integrity";

describe("data integrity service", () => {
  it("returns only actionable non-zero findings", async () => {
    listDataIntegrityFindings.mockResolvedValue([
      { check: "sessions.user_id", count: 0 },
      { check: "org_members.user_id", count: 2 },
    ]);
    const now = new Date("2026-08-23T12:00:00.000Z");

    await expect(checkDataIntegrity(now)).resolves.toEqual({
      checkedAt: now,
      healthy: false,
      checks: 2,
      findings: [{ check: "org_members.user_id", count: 2 }],
    });
  });
});
