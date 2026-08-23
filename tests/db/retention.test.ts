import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";
import { db } from "@/db";
import {
  adminAuditLogs,
  authEvents,
  jobs,
  marketingProviderEvents,
} from "@/db/schema";
import { insertJob } from "@/models/job";
import { applyRetentionPolicy, getRetentionReport } from "@/services/retention";

describeDb("operational retention (real database)", () => {
  useCleanDatabase();

  it("reports and deletes only rows older than each policy cutoff", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const old = new Date("2025-01-01T00:00:00.000Z");
    const recent = new Date("2026-08-20T00:00:00.000Z");

    const oldJob = await insertJob({ type: "welcome_email", payload: {} });
    const recentJob = await insertJob({ type: "welcome_email", payload: {} });
    await db()
      .update(jobs)
      .set({ status: "succeeded", completed_at: old })
      .where(eq(jobs.uuid, oldJob!.uuid));
    await db()
      .update(jobs)
      .set({ status: "succeeded", completed_at: recent })
      .where(eq(jobs.uuid, recentJob!.uuid));

    await db()
      .insert(marketingProviderEvents)
      .values([
        {
          event_id: `evt-old-${randomUUID()}`,
          event_type: "email.delivered",
          outcome: "processed",
          occurred_at: old,
          received_at: old,
        },
        {
          event_id: `evt-recent-${randomUUID()}`,
          event_type: "email.delivered",
          outcome: "processed",
          occurred_at: recent,
          received_at: recent,
        },
      ]);
    await db()
      .insert(authEvents)
      .values([
        {
          uuid: randomUUID(),
          event: "signin",
          created_at: old,
        },
        {
          uuid: randomUUID(),
          event: "signin",
          created_at: recent,
        },
      ]);
    await db()
      .insert(adminAuditLogs)
      .values([
        {
          uuid: randomUUID(),
          actor_uuid: "admin-old",
          action: "test.action",
          created_at: old,
        },
        {
          uuid: randomUUID(),
          actor_uuid: "admin-recent",
          action: "test.action",
          created_at: recent,
        },
      ]);

    const report = await getRetentionReport(now);
    expect(report.candidates).toMatchObject({
      finishedJobs: { count: 1 },
      marketingProviderEvents: { count: 1 },
      authEvents: { count: 1 },
      adminAuditLogs: { count: 1 },
    });

    const result = await applyRetentionPolicy(now);
    expect(result.deleted).toEqual({
      finishedJobs: 1,
      marketingProviderEvents: 1,
      authEvents: 1,
      adminAuditLogs: 1,
    });
    expect(await db().$count(jobs)).toBe(1);
    expect(await db().$count(marketingProviderEvents)).toBe(1);
    expect(await db().$count(authEvents)).toBe(1);
    expect(await db().$count(adminAuditLogs)).toBe(1);
  });
});
