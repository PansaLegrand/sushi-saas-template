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

async function expectCheck(
  values: ReturnType<typeof candidate> & Record<string, unknown>,
  constraintName: string,
) {
  try {
    await db().insert(files).values(values as never);
    throw new Error(`expected ${constraintName} to reject the file`);
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint_name?: string } })
      .cause;
    expect(cause?.code).toBe("23514");
    expect(cause?.constraint_name).toBe(constraintName);
  }
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

  it("rejects unsupported file states, visibility, and negative sizes", async () => {
    await expectCheck(
      { ...candidate("invalid-status"), status: "ready" },
      "files_status_check",
    );
    await expectCheck(
      { ...candidate("invalid-visibility"), visibility: "internet" },
      "files_visibility_check",
    );
    await expectCheck(
      { ...candidate("invalid-size"), size: -1 },
      "files_size_check",
    );
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
