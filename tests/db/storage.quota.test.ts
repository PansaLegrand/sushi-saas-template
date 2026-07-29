/**
 * Database tier: storage quota reservation.
 *
 * The invariant is the organization advisory lock around "sum + insert".
 * Mocks cannot prove two connections do not both consume the same allowance.
 */
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { files, jobs } from "@/db/schema";
import { reserveFileWithinQuota, scheduleFileDeletion } from "@/models/file";

import { describeDb, useCleanDatabase } from "./setup";

function candidate(uuid: string) {
  return {
    uuid,
    org_uuid: "org-storage",
    user_uuid: "user-storage",
    provider: "s3",
    bucket: "test",
    key: `uploads/${uuid}`,
    original_filename: `${uuid}.txt`,
    content_type: "text/plain",
    size: 60,
    status: "uploading",
  };
}

describeDb("storage quota reservation (real database)", () => {
  useCleanDatabase();

  it("allows only one of two uploads competing for the same quota", async () => {
    const results = await Promise.all([
      reserveFileWithinQuota(candidate("file-1"), 100),
      reserveFileWithinQuota(candidate("file-2"), 100),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await db().select().from(files)).toHaveLength(1);
  });

  it("does not count a fully deleted object against quota", async () => {
    await reserveFileWithinQuota(candidate("file-1"), 100);
    await db().update(files).set({ status: "deleted", deleted_at: new Date() });

    await expect(
      reserveFileWithinQuota(candidate("file-2"), 100),
    ).resolves.toMatchObject({ ok: true, usedBytes: 0 });
  });

  it("revives an exhausted object-deletion job without duplicating it", async () => {
    await reserveFileWithinQuota(candidate("file-1"), 100);
    await scheduleFileDeletion({
      uuid: "file-1",
      orgUuid: "org-storage",
      expectedStatuses: ["uploading"],
      maxAttempts: 2,
    });
    await db()
      .update(jobs)
      .set({
        status: "failed",
        attempts: 2,
        last_error: "provider unavailable",
        completed_at: new Date(),
      })
      .where(eq(jobs.dedupe_key, "storage_object_delete:org-storage:file-1"));

    await expect(
      scheduleFileDeletion({
        uuid: "file-1",
        orgUuid: "org-storage",
      }),
    ).resolves.toMatchObject({ queued: true });

    const queued = await db().select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      last_error: null,
      completed_at: null,
      subject_org_uuid: "org-storage",
    });
  });
});
