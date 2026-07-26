/**
 * Database tier: cross-tenant isolation, end to end.
 *
 * Every other test in this suite checks that a feature works. This one checks
 * the thing that has to be true regardless of feature: **two organizations
 * cannot see or spend each other's data**. It goes through the real model
 * functions rather than hand-written SQL, because the failure it guards against
 * is a forgotten `where` clause in exactly those functions — a bug that throws
 * nothing, logs nothing, and surfaces only when a customer sees another
 * customer's files.
 *
 * Two fully separate tenants are seeded, each with their own user, and every
 * read is asserted from both sides: the owner sees theirs, the neighbour sees
 * nothing.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { users } from "@/db/schema";
import { insertFile, findFileByUuid, listFilesByOrg, sumFileBytesByOrg } from "@/models/file";
import { insertTask, findTaskByUuid, getTasksByOrg, updateTaskStatus } from "@/models/task";
import { insertCredit, listAllCreditsByOrg } from "@/models/credit";
import {
  decreaseCredits,
  getOrgCreditSummary,
  refundCreditsForTransaction,
  CreditsTransType,
} from "@/services/credit";
import { ensurePersonalOrganization } from "@/services/organizations";

useCleanDatabase();

type Tenant = { userUuid: string; orgUuid: string };

async function seedTenant(label: string): Promise<Tenant> {
  const id = randomUUID();
  const uuid = randomUUID();
  const email = `${label}-${uuid}@test.dev`;

  await db().insert(users).values({ id, uuid, email, signin_provider: "credential" });
  const org = await ensurePersonalOrganization({ id, email });

  return { userUuid: uuid, orgUuid: org.uuid };
}

let acme: Tenant;
let initech: Tenant;

beforeEach(async () => {
  acme = await seedTenant("acme");
  initech = await seedTenant("initech");
});

describeDb("cross-tenant isolation (real database)", () => {
  it("keeps one organization's files invisible to another", async () => {
    const uuid = randomUUID();

    await insertFile({
      uuid,
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      bucket: "b",
      key: `k-${uuid}`,
      size: 1024,
      status: "active",
    } as Parameters<typeof insertFile>[0]);

    expect(await findFileByUuid(uuid, acme.orgUuid)).toBeDefined();
    // Knowing the uuid must not be enough. A link pasted into the wrong chat
    // has to 404, not serve the file.
    expect(await findFileByUuid(uuid, initech.orgUuid)).toBeUndefined();

    expect(await listFilesByOrg(acme.orgUuid)).toHaveLength(1);
    expect(await listFilesByOrg(initech.orgUuid)).toHaveLength(0);
  });

  it("counts storage usage per organization", async () => {
    for (const tenant of [acme, acme, initech]) {
      const uuid = randomUUID();
      await insertFile({
        uuid,
        org_uuid: tenant.orgUuid,
        user_uuid: tenant.userUuid,
        bucket: "b",
        key: `k-${uuid}`,
        size: 100,
        status: "active",
      } as Parameters<typeof insertFile>[0]);
    }

    // A quota that summed across tenants would throttle a customer because
    // somebody else uploaded.
    expect(await sumFileBytesByOrg(acme.orgUuid)).toBe(200);
    expect(await sumFileBytesByOrg(initech.orgUuid)).toBe(100);
  });

  it("refuses to update another organization's task", async () => {
    const uuid = randomUUID();

    await insertTask({
      uuid,
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      type: "text_to_video",
      status: "queued",
    } as Parameters<typeof insertTask>[0]);

    expect(await findTaskByUuid(uuid, initech.orgUuid)).toBeUndefined();
    expect(await getTasksByOrg(initech.orgUuid)).toHaveLength(0);

    // The scope is in the UPDATE's own where clause, so a wrong-tenant write
    // affects zero rows rather than silently succeeding.
    expect(await updateTaskStatus(uuid, initech.orgUuid, "succeeded")).toBeUndefined();
    expect((await findTaskByUuid(uuid, acme.orgUuid))?.status).toBe("queued");
  });

  it("keeps balances separate", async () => {
    await insertCredit({
      trans_no: randomUUID(),
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });

    expect((await getOrgCreditSummary(acme.orgUuid)).balance).toBe(100);
    expect((await getOrgCreditSummary(initech.orgUuid)).balance).toBe(0);
    expect(await listAllCreditsByOrg(initech.orgUuid)).toHaveLength(0);
  });

  it("will not spend another organization's credits", async () => {
    await insertCredit({
      trans_no: randomUUID(),
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });

    await expect(
      decreaseCredits({
        org_uuid: initech.orgUuid,
        user_uuid: initech.userUuid,
        trans_type: CreditsTransType.Ping,
        credits: 10,
      })
    ).rejects.toThrow(/insufficient/i);

    expect((await getOrgCreditSummary(acme.orgUuid)).balance).toBe(100);
  });

  it("will not refund a transaction belonging to another organization", async () => {
    await insertCredit({
      trans_no: randomUUID(),
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });

    const transNo = await decreaseCredits({
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.Ping,
      credits: 10,
    });

    // `findCreditByTransNo` is unscoped by necessity, so the ownership proof
    // lives in the service. Reported as not-found: whether a transaction exists
    // in another tenant is not something this caller gets to learn.
    await expect(
      refundCreditsForTransaction({
        org_uuid: initech.orgUuid,
        user_uuid: initech.userUuid,
        original_trans_no: transNo,
      })
    ).rejects.toThrow(/does not belong/i);
  });
});

describeDb("pooled credit spend (real database)", () => {
  it("serializes concurrent spends by two members of one organization", async () => {
    // The reason the advisory lock had to move from `user_uuid` to `org_uuid`.
    // With a per-user lock these two spends take different locks, both read the
    // same balance, and both succeed — spending 60 credits out of 50.
    const second = await db().insert(users).values({
      id: randomUUID(),
      uuid: randomUUID(),
      email: `colleague-${randomUUID()}@test.dev`,
      signin_provider: "credential",
    }).returning();

    await insertCredit({
      trans_no: randomUUID(),
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 50,
    });

    const spend = (userUuid: string) =>
      decreaseCredits({
        org_uuid: acme.orgUuid,
        user_uuid: userUuid,
        trans_type: CreditsTransType.Ping,
        credits: 30,
      }).then(
        () => "ok" as const,
        () => "rejected" as const
      );

    const results = await Promise.all([
      spend(acme.userUuid),
      spend(second[0].uuid),
    ]);

    // Exactly one succeeds: 30 + 30 does not fit in 50.
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "rejected")).toHaveLength(1);

    const summary = await getOrgCreditSummary(acme.orgUuid);
    expect(summary.balance).toBe(20);
    // The invariant that actually matters: a pooled balance never goes negative.
    expect(summary.balance).toBeGreaterThanOrEqual(0);
  });

  it("records which member spent, even though the balance is shared", async () => {
    await insertCredit({
      trans_no: randomUUID(),
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });

    await decreaseCredits({
      org_uuid: acme.orgUuid,
      user_uuid: acme.userUuid,
      trans_type: CreditsTransType.Ping,
      credits: 10,
    });

    // Per-member quotas and usage reporting are impossible to build later if
    // nobody recorded the actor at the time.
    const ledger = await listAllCreditsByOrg(acme.orgUuid);
    const spend = ledger.find((row) => row.credits < 0);

    expect(spend?.user_uuid).toBe(acme.userUuid);
    expect(spend?.org_uuid).toBe(acme.orgUuid);
  });
});
