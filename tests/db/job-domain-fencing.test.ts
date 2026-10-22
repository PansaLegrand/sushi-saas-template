/** An old execution must not change domain state after its lease is replaced. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db";
import { files, jobs, privacyRequests, tasks } from "@/db/schema";
import { activateUploadingFile } from "@/models/file";
import { transitionTaskStatus } from "@/models/task";
import {
  markPrivacyRequestFailed,
  recordPrivacyExternalEffect,
} from "@/models/account-lifecycle";
import type { JobLease } from "@/models/job";
import { describeDb, useCleanDatabase } from "./setup";

describeDb("domain execution fencing", () => {
  useCleanDatabase();

  async function replacedLease(): Promise<{
    old: JobLease;
    current: JobLease;
  }> {
    const uuid = randomUUID();
    const old = { uuid, lockedAt: new Date(Date.now() - 60_000) };
    const current = { uuid, lockedAt: new Date() };
    await db()
      .insert(jobs)
      .values({
        uuid,
        type: "image_generation",
        status: "running",
        attempts: 2,
        locked_at: current.lockedAt,
      });
    return { old, current };
  }

  it("refuses an old task completion while the new execution can finish", async () => {
    const lease = await replacedLease();
    const uuid = randomUUID();
    const orgUuid = randomUUID();
    await db()
      .insert(tasks)
      .values({
        uuid,
        org_uuid: orgUuid,
        user_uuid: randomUUID(),
        type: "image_generation",
        status: "running",
        job_uuid: lease.current.uuid,
      });
    await expect(
      transitionTaskStatus(
        uuid,
        orgUuid,
        ["running"],
        "refunding",
        {},
        lease.old,
      ),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(
      await transitionTaskStatus(
        uuid,
        orgUuid,
        ["running"],
        "succeeded",
        {},
        lease.current,
      ),
    ).toMatchObject({ status: "succeeded" });
  });

  it("refuses stale file activation", async () => {
    const lease = await replacedLease();
    const uuid = randomUUID();
    const orgUuid = randomUUID();
    await db()
      .insert(files)
      .values({
        uuid,
        org_uuid: orgUuid,
        user_uuid: randomUUID(),
        provider: "s3",
        bucket: "private",
        key: uuid,
        status: "uploading",
      });
    await expect(
      activateUploadingFile(uuid, orgUuid, { size: 42 }, lease.old),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const [file] = await db().select().from(files).where(eq(files.uuid, uuid));
    expect(file.status).toBe("uploading");
  });

  it("refuses stale privacy failure and checkpoint writes", async () => {
    const lease = await replacedLease();
    const uuid = randomUUID();
    await db()
      .insert(privacyRequests)
      .values({
        uuid,
        user_id: randomUUID(),
        user_uuid: randomUUID(),
        request_type: "erasure",
        idempotency_key: uuid,
        request_fingerprint: uuid,
        scheduled_at: new Date(),
        status: "processing",
      });
    await expect(
      markPrivacyRequestFailed(uuid, "late failure", lease.old),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      recordPrivacyExternalEffect({
        requestUuid: uuid,
        effect: "storageFiles",
        id: "file",
        lease: lease.old,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const [request] = await db()
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.uuid, uuid));
    expect(request).toMatchObject({
      status: "processing",
      external_state_json: null,
      last_error: null,
    });
  });
});
