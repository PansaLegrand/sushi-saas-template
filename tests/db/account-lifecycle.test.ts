/**
 * Account lifecycle database invariants.
 *
 * Advisory locking and financial pseudonymization are transaction properties;
 * mocks cannot prove that two retries create one job or that retained ledger
 * rows survive after the authentication identity is gone.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  affiliateDeduplicationArchive,
  credits,
  files,
  jobs,
  orders,
  orgMembers,
  organizations,
  privacyRequests,
  sessions,
  twoFactor,
  users,
  verifications,
} from "@/db/schema";
import {
  createPrivacyRequest,
  finalizeAccountErasure,
  getAccountExportData,
  prepareAccountExportArtifact,
} from "@/models/account-lifecycle";
import { ensurePersonalOrganization } from "@/services/organizations";

import { describeDb, useCleanDatabase } from "./setup";

useCleanDatabase();

async function account() {
  const user = {
    id: randomUUID(),
    uuid: randomUUID(),
    email: `lifecycle-${randomUUID()}@test.dev`,
    signin_provider: "credential",
  } satisfies typeof users.$inferInsert;
  await db().insert(users).values(user);
  const organization = await ensurePersonalOrganization({
    id: user.id,
    email: user.email,
  });
  return { user, organization };
}

describeDb("account lifecycle transactions", () => {
  it("turns concurrent deletion retries into one request and one job", async () => {
    const { user } = await account();
    const key = randomUUID();
    const scheduledAt = new Date(Date.now() + 60_000);
    const base = {
      requestType: "erasure" as const,
      userId: user.id,
      userUuid: user.uuid,
      idempotencyKey: key,
      fingerprint: "a".repeat(64),
      scheduledAt,
      erasedSubjectUuid: `erased-${randomUUID()}`,
      maxAttempts: 20,
    };

    const [first, second] = await Promise.all([
      createPrivacyRequest({
        ...base,
        uuid: randomUUID(),
        jobUuid: randomUUID(),
      }),
      createPrivacyRequest({
        ...base,
        uuid: randomUUID(),
        jobUuid: randomUUID(),
      }),
    ]);

    expect(["created", "reused"]).toContain(first.outcome);
    expect(["created", "reused"]).toContain(second.outcome);
    const rows = await db()
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.user_uuid, user.uuid));
    const queued = await db()
      .select()
      .from(jobs)
      .where(eq(jobs.subject_user_uuid, user.uuid));
    const [storedUser] = await db()
      .select()
      .from(users)
      .where(eq(users.id, user.id));

    expect(rows).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(storedUser.lifecycle_status).toBe("deletion_pending");
  });

  it("blocks erasure until sole ownership is transferred", async () => {
    const { user } = await account();
    const collaborator = {
      id: randomUUID(),
      uuid: randomUUID(),
      email: `collaborator-${randomUUID()}@test.dev`,
      signin_provider: "credential",
    } satisfies typeof users.$inferInsert;
    const sharedOrganization = {
      id: randomUUID(),
      uuid: randomUUID(),
      name: "Shared workspace",
      slug: `shared-${randomUUID()}`,
    } satisfies typeof organizations.$inferInsert;

    await db().insert(users).values(collaborator);
    await db().insert(organizations).values(sharedOrganization);
    await db()
      .insert(orgMembers)
      .values([
        {
          id: randomUUID(),
          organization_id: sharedOrganization.id,
          user_id: user.id,
          role: "owner",
        },
        {
          id: randomUUID(),
          organization_id: sharedOrganization.id,
          user_id: collaborator.id,
          role: "member",
        },
      ]);

    const result = await createPrivacyRequest({
      uuid: randomUUID(),
      requestType: "erasure",
      userId: user.id,
      userUuid: user.uuid,
      idempotencyKey: randomUUID(),
      fingerprint: "c".repeat(64),
      scheduledAt: new Date(),
      erasedSubjectUuid: `erased-${randomUUID()}`,
      jobUuid: randomUUID(),
      maxAttempts: 20,
    });

    if (result.outcome !== "blocked") {
      throw new Error(`expected owner blocker, received ${result.outcome}`);
    }
    expect(result.blockers).toContainEqual({
      kind: "owner_transfer",
      organizations: [
        {
          uuid: sharedOrganization.uuid,
          slug: sharedOrganization.slug,
          name: sharedOrganization.name,
        },
      ],
    });
    expect(
      await db()
        .select()
        .from(jobs)
        .where(eq(jobs.subject_user_uuid, user.uuid)),
    ).toHaveLength(0);
    const [storedUser] = await db()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(storedUser.lifecycle_status).toBe("active");
  });

  it("preserves an active full-access administrator", async () => {
    const { user } = await account();
    await db()
      .update(users)
      .set({ role: "admin_rw" })
      .where(eq(users.id, user.id));

    const result = await createPrivacyRequest({
      uuid: randomUUID(),
      requestType: "erasure",
      userId: user.id,
      userUuid: user.uuid,
      idempotencyKey: randomUUID(),
      fingerprint: "d".repeat(64),
      scheduledAt: new Date(),
      erasedSubjectUuid: `erased-${randomUUID()}`,
      jobUuid: randomUUID(),
      maxAttempts: 20,
    });

    if (result.outcome !== "blocked") {
      throw new Error(`expected admin blocker, received ${result.outcome}`);
    }
    expect(result.blockers).toContainEqual({ kind: "admin_continuity" });
    expect(
      await db()
        .select()
        .from(jobs)
        .where(eq(jobs.subject_user_uuid, user.uuid)),
    ).toHaveLength(0);
  });

  it("exports account data without authentication or storage secrets", async () => {
    const { user, organization } = await account();
    const secrets = {
      access: `access-${randomUUID()}`,
      refresh: `refresh-${randomUUID()}`,
      idToken: `id-token-${randomUUID()}`,
      password: `password-${randomUUID()}`,
      session: `session-${randomUUID()}`,
      twoFactor: `two-factor-${randomUUID()}`,
      backupCodes: `backup-${randomUUID()}`,
      bucket: `private-bucket-${randomUUID()}`,
      key: `private-key-${randomUUID()}`,
    };

    await db().insert(accounts).values({
      id: randomUUID(),
      user_id: user.id,
      account_id: user.email,
      provider_id: "credential",
      access_token: secrets.access,
      refresh_token: secrets.refresh,
      id_token: secrets.idToken,
      password: secrets.password,
    });
    await db()
      .insert(sessions)
      .values({
        id: randomUUID(),
        user_id: user.id,
        token: secrets.session,
        expires_at: new Date(Date.now() + 60_000),
      });
    await db().insert(twoFactor).values({
      user_id: user.id,
      secret: secrets.twoFactor,
      backup_codes: secrets.backupCodes,
    });
    await db().insert(files).values({
      uuid: randomUUID(),
      user_uuid: user.uuid,
      bucket: secrets.bucket,
      key: secrets.key,
      original_filename: "invoice.pdf",
      status: "active",
      org_uuid: organization.uuid,
    });
    await db()
      .insert(affiliateDeduplicationArchive)
      .values({
        original_affiliate_id: 101,
        canonical_affiliate_id: 100,
        reason: "paid_order_replay",
        original_row_json: JSON.stringify({
          id: 101,
          user_uuid: user.uuid,
          invited_by: "referrer_1",
          paid_order_no: "order_archive_export",
          paid_amount: 2500,
        }),
      });

    const exported = await getAccountExportData({
      userId: user.id,
      userUuid: user.uuid,
    });
    const publicDocument = JSON.stringify(exported?.snapshot);

    expect(exported?.snapshot.profile).toMatchObject({ email: user.email });
    expect(exported?.snapshot.affiliateDeduplicationArchive).toHaveLength(1);
    for (const secret of Object.values(secrets)) {
      expect(publicDocument).not.toContain(secret);
    }
    expect(exported?.fileObjects).toContainEqual(
      expect.objectContaining({
        bucket: secrets.bucket,
        key: secrets.key,
      }),
    );
  });

  it("registers export cleanup durably before object upload", async () => {
    const { user } = await account();
    const requestUuid = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const bucket = "private";
    const key = `account-exports/${requestUuid}/account-data.json`;

    const created = await createPrivacyRequest({
      uuid: requestUuid,
      requestType: "export",
      userId: user.id,
      userUuid: user.uuid,
      idempotencyKey: randomUUID(),
      fingerprint: "e".repeat(64),
      scheduledAt: new Date(),
      erasedSubjectUuid: `erased-${randomUUID()}`,
      jobUuid: randomUUID(),
      maxAttempts: 8,
    });
    expect(created.outcome).toBe("created");

    await expect(
      prepareAccountExportArtifact({
        requestUuid,
        bucket,
        key,
        expiresAt,
        cleanupJobUuid: randomUUID(),
      }),
    ).resolves.toBe(true);

    const [storedRequest] = await db()
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, requestUuid));
    const cleanupJobs = await db()
      .select()
      .from(jobs)
      .where(eq(jobs.dedupe_key, `account_export_expire:${requestUuid}`));

    expect(storedRequest).toMatchObject({
      export_bucket: bucket,
      export_key: key,
    });
    expect(storedRequest.export_expires_at?.getTime()).toBe(
      expiresAt.getTime(),
    );
    expect(cleanupJobs).toHaveLength(1);
    expect(cleanupJobs[0]).toMatchObject({
      type: "account_export_expire",
      status: "pending",
      subject_user_uuid: user.uuid,
    });
  });

  it("removes credentials while preserving pseudonymized money records", async () => {
    const { user, organization } = await account();
    const erased = `erased-${randomUUID()}`;
    const requestUuid = randomUUID();

    await db()
      .update(users)
      .set({ lifecycle_status: "erasing" })
      .where(eq(users.id, user.id));
    await db()
      .insert(privacyRequests)
      .values({
        uuid: requestUuid,
        request_type: "erasure",
        user_id: user.id,
        user_uuid: user.uuid,
        status: "processing",
        idempotency_key: randomUUID(),
        request_fingerprint: "b".repeat(64),
        erased_subject_uuid: erased,
        scheduled_at: new Date(),
        started_at: new Date(),
      });
    await db().insert(accounts).values({
      id: randomUUID(),
      user_id: user.id,
      account_id: user.email,
      provider_id: "credential",
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      password: "secret-password-hash",
    });
    await db()
      .insert(sessions)
      .values({
        id: randomUUID(),
        user_id: user.id,
        token: "secret-session-token",
        expires_at: new Date(Date.now() + 60_000),
      });
    await db().insert(twoFactor).values({
      user_id: user.id,
      secret: "secret-totp-seed",
      backup_codes: "secret-backup-codes",
    });
    await db()
      .insert(verifications)
      .values({
        id: randomUUID(),
        identifier: user.email,
        value: "secret-verification-token",
        expires_at: new Date(Date.now() + 60_000),
      });
    await db().insert(orders).values({
      order_no: randomUUID(),
      user_uuid: user.uuid,
      user_email: user.email,
      paid_email: user.email,
      amount: 2500,
      status: "paid",
      credits: 100,
      org_uuid: organization.uuid,
    });
    await db()
      .insert(credits)
      .values({
        trans_no: randomUUID(),
        user_uuid: user.uuid,
        trans_type: "order_pay",
        credits: 100,
        org_uuid: organization.uuid,
        actor: `user:${user.uuid}`,
      });
    await db()
      .insert(affiliateDeduplicationArchive)
      .values({
        original_affiliate_id: 201,
        canonical_affiliate_id: 200,
        reason: "signup_attribution_replay",
        original_row_json: JSON.stringify({
          id: 201,
          user_uuid: user.uuid,
          invited_by: user.uuid,
          paid_order_no: "",
        }),
      });

    await expect(
      finalizeAccountErasure({
        requestUuid,
        requireStripeCustomerDeletion: true,
        retainSecurityBlocklistEntries: true,
      }),
    ).resolves.toBe("completed");

    const [deletedUser] = await db()
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    const [retainedOrder] = await db()
      .select()
      .from(orders)
      .where(eq(orders.org_uuid, organization.uuid));
    const [retainedCredit] = await db()
      .select()
      .from(credits)
      .where(eq(credits.org_uuid, organization.uuid));
    const [tombstone] = await db()
      .select()
      .from(organizations)
      .where(eq(organizations.uuid, organization.uuid));
    const [auditRequest] = await db()
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, requestUuid));
    const [archivedAffiliate] = await db()
      .select()
      .from(affiliateDeduplicationArchive)
      .where(eq(affiliateDeduplicationArchive.original_affiliate_id, 201));
    const credentialRows = await db()
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.user_id, user.id));
    const sessionRows = await db()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.user_id, user.id));
    const twoFactorRows = await db()
      .select({ id: twoFactor.id })
      .from(twoFactor)
      .where(eq(twoFactor.user_id, user.id));
    const verificationRows = await db()
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.identifier, user.email));

    expect(deletedUser).toBeUndefined();
    expect(credentialRows).toHaveLength(0);
    expect(sessionRows).toHaveLength(0);
    expect(twoFactorRows).toHaveLength(0);
    expect(verificationRows).toHaveLength(0);
    expect(retainedOrder).toMatchObject({
      user_uuid: erased,
      user_email: "",
      paid_email: null,
    });
    expect(retainedCredit).toMatchObject({
      user_uuid: erased,
      actor: `erased:${erased}`,
    });
    expect(tombstone).toMatchObject({
      lifecycle_status: "deleted",
      name: "Deleted workspace",
      stripe_customer_id: null,
    });
    expect(auditRequest).toMatchObject({
      status: "completed",
      user_id: erased,
      user_uuid: erased,
      erased_subject_uuid: null,
    });
    expect(archivedAffiliate.original_row_json).not.toContain(user.uuid);
    expect(archivedAffiliate.original_row_json).toContain(erased);
  });
});
