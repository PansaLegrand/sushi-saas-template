import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";
import { db } from "@/db";
import {
  affiliates,
  credits,
  feedbacks,
  orders,
  orgMembers,
} from "@/db/schema";
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

  it("reports historical null timestamps before a NOT NULL contract migration", async () => {
    const suffix = randomUUID();
    await Promise.all([
      db().insert(orders).values({
        order_no: `order-${suffix}`,
        created_at: null,
        amount: 0,
        status: "created",
        credits: 0,
        org_uuid: `org-${suffix}`,
      }),
      db().insert(credits).values({
        trans_no: `credit-${suffix}`,
        created_at: null,
        user_uuid: "erased-subject",
        org_uuid: `org-${suffix}`,
        trans_type: "system_add",
        credits: 1,
      }),
      db().insert(affiliates).values({
        user_uuid: `affiliate-${suffix}`,
        invited_by: `inviter-${suffix}`,
        created_at: null,
      }),
      db().insert(feedbacks).values({
        content: "legacy feedback",
        created_at: null,
      }),
    ]);

    const report = await checkDataIntegrity();
    expect(report.findings).toEqual(
      expect.arrayContaining([
        { check: "orders.created_at", count: 1 },
        { check: "credits.created_at", count: 1 },
        { check: "affiliates.created_at", count: 1 },
        { check: "feedbacks.created_at", count: 1 },
      ]),
    );
  });
});
