/**
 * Database tier: compatibility defaults on historical nullable timestamps.
 *
 * These columns stay nullable until a later contract migration, so TypeScript
 * cannot prove that omitting one still records an ordering timestamp. This test
 * pins the database defaults that protect old and direct writers during that
 * compatibility window.
 */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { db } from "@/db";
import { affiliates, credits, feedbacks, orders } from "@/db/schema";

import { describeDb, useCleanDatabase } from "./setup";

describeDb("historical timestamp defaults (real database)", () => {
  useCleanDatabase();

  it("fills every legacy created_at when a writer omits it", async () => {
    const suffix = randomUUID();
    const [[order], [credit], [affiliate], [feedback]] = await Promise.all([
      db()
        .insert(orders)
        .values({
          order_no: `order-${suffix}`,
          amount: 0,
          status: "created",
          credits: 0,
          org_uuid: `org-${suffix}`,
        })
        .returning({ createdAt: orders.created_at }),
      db()
        .insert(credits)
        .values({
          trans_no: `credit-${suffix}`,
          user_uuid: "erased-subject",
          org_uuid: `org-${suffix}`,
          trans_type: "system_add",
          credits: 1,
        })
        .returning({ createdAt: credits.created_at }),
      db()
        .insert(affiliates)
        .values({
          user_uuid: `affiliate-${suffix}`,
          invited_by: `inviter-${suffix}`,
        })
        .returning({ createdAt: affiliates.created_at }),
      db()
        .insert(feedbacks)
        .values({ content: "default timestamp" })
        .returning({ createdAt: feedbacks.created_at }),
    ]);

    for (const row of [order, credit, affiliate, feedback]) {
      expect(row?.createdAt).toBeInstanceOf(Date);
    }
  });
});
