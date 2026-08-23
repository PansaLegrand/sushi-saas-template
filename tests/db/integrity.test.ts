import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";
import { db } from "@/db";
import { orgMembers } from "@/db/schema";
import { checkDataIntegrity } from "@/services/integrity";

describeDb("data integrity sweep (real database)", () => {
  useCleanDatabase();

  it("detects relationships the legacy schema does not enforce", async () => {
    await db().insert(orgMembers).values({
      id: randomUUID(),
      organization_id: "missing-organization",
      user_id: "missing-user",
      role: "member",
    });

    const report = await checkDataIntegrity();
    expect(report.healthy).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        { check: "org_members.organization_id", count: 1 },
        { check: "org_members.user_id", count: 1 },
      ]),
    );
  });
});
