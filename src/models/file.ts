import { db } from "@/db";
import { files, jobs } from "@/db/schema";
import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { scopedToOrg } from "./organization";

/**
 * Uploads, scoped to the organization that owns them.
 *
 * Every read here takes an `orgUuid` and every write requires one in the row.
 * Lookups by the file's own uuid are scoped too: a uuid is unguessable, but
 * "unguessable" is not an authorization model — a link pasted into the wrong
 * chat should still 404 for another tenant rather than serve the file.
 */

/** `org_uuid` is required, not optional-with-a-default: a file with no tenant is unreachable. */
export type FileInsert = typeof files.$inferInsert & { org_uuid: string };

export async function insertFile(
  data: FileInsert,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db().insert(files).values(data).returning();
  return row;
}

export type FileReservationOutcome =
  | { ok: true; file: typeof files.$inferSelect; usedBytes: number }
  | { ok: false; usedBytes: number };

/**
 * Reserve upload quota and insert the uploading row under one organization
 * lock. Separate "sum then insert" calls let two concurrent uploads both spend
 * the same remaining allowance.
 */
export async function reserveFileWithinQuota(
  data: FileInsert & { size: number },
  maxBytes: number | null,
): Promise<FileReservationOutcome> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`storage-quota:${data.org_uuid}`}, 0::bigint)
      )
    `);

    const [usage] = await tx
      .select({ total: sql<string | null>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .where(
        and(
          scopedToOrg(files.org_uuid, data.org_uuid),
          inArray(files.status, ["uploading", "active", "deleting"]),
        ),
      );

    const usedBytes = Number(usage?.total ?? 0);
    if (maxBytes !== null && usedBytes + data.size > maxBytes) {
      return { ok: false, usedBytes };
    }

    const [file] = await tx.insert(files).values(data).returning();
    return { ok: true, file, usedBytes };
  });
}

export async function findFileByUuid(
  uuid: string,
  orgUuid: string,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .select()
    .from(files)
    .where(and(eq(files.uuid, uuid), scopedToOrg(files.org_uuid, orgUuid)))
    .limit(1);
  return row;
}

export async function updateFileByUuid(
  uuid: string,
  orgUuid: string,
  patch: Partial<typeof files.$inferInsert>,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ ...patch, updated_at: new Date() })
    .where(and(eq(files.uuid, uuid), scopedToOrg(files.org_uuid, orgUuid)))
    .returning();
  return row;
}

/**
 * Activate only a still-pending upload.
 *
 * Cleanup may schedule deletion after the completion route reads the row. A
 * status predicate prevents that stale completion request from changing
 * `deleting` back to `active` while the object-delete worker is running.
 */
export async function activateUploadingFile(
  uuid: string,
  orgUuid: string,
  patch: Partial<typeof files.$inferInsert>,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ ...patch, status: "active", updated_at: new Date() })
    .where(
      and(
        eq(files.uuid, uuid),
        scopedToOrg(files.org_uuid, orgUuid),
        eq(files.status, "uploading"),
      ),
    )
    .returning();

  return row;
}

export async function listFilesByOrg(
  orgUuid: string,
  page: number = 1,
  limit: number = 50,
  includeDeleted = false,
): Promise<(typeof files.$inferSelect)[]> {
  const offset = (page - 1) * limit;

  const scope = scopedToOrg(files.org_uuid, orgUuid);
  const where = includeDeleted ? scope : and(scope, eq(files.status, "active"));

  const rows = await db()
    .select()
    .from(files)
    .where(where)
    .orderBy(desc(files.created_at))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function softDeleteFile(
  uuid: string,
  orgUuid: string,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ status: "deleted", deleted_at: new Date(), updated_at: new Date() })
    .where(and(eq(files.uuid, uuid), scopedToOrg(files.org_uuid, orgUuid)))
    .returning();
  return row;
}

/** Stop serving a file immediately while durable object deletion is pending. */
export async function markFileDeleting(
  uuid: string,
  orgUuid: string,
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ status: "deleting", updated_at: new Date() })
    .where(
      and(
        eq(files.uuid, uuid),
        scopedToOrg(files.org_uuid, orgUuid),
        ne(files.status, "deleted"),
      ),
    )
    .returning();

  return row;
}

/**
 * Stop serving an object and enqueue its provider deletion in one transaction.
 *
 * Updating the file first and inserting a job second leaves a permanent
 * `deleting` row if the queue insert fails. In the reverse order a worker can
 * race ahead while the file is still readable. One transaction closes both
 * failure windows.
 */
export async function scheduleFileDeletion(params: {
  uuid: string;
  orgUuid: string;
  expectedStatuses?: readonly string[];
  patch?: Partial<typeof files.$inferInsert>;
  maxAttempts?: number;
}): Promise<
  | {
      file: typeof files.$inferSelect;
      queued: boolean;
    }
  | undefined
> {
  const dedupeKey = `storage_object_delete:${params.orgUuid}:${params.uuid}`;

  return db().transaction(async (tx) => {
    const predicates = [
      eq(files.uuid, params.uuid),
      scopedToOrg(files.org_uuid, params.orgUuid),
      ne(files.status, "deleted"),
    ];
    if (params.expectedStatuses?.length) {
      predicates.push(inArray(files.status, [...params.expectedStatuses]));
    }

    const [file] = await tx
      .update(files)
      .set({
        ...params.patch,
        status: "deleting",
        updated_at: new Date(),
      })
      .where(and(...predicates))
      .returning();

    if (!file) return undefined;

    const now = new Date();
    const [revived] = await tx
      .update(jobs)
      .set({
        status: "pending",
        attempts: 0,
        max_attempts: params.maxAttempts ?? 10,
        run_at: now,
        locked_at: null,
        last_error: null,
        completed_at: null,
        subject_user_uuid: file.user_uuid,
        subject_org_uuid: params.orgUuid,
        updated_at: now,
      })
      .where(
        and(
          eq(jobs.dedupe_key, dedupeKey),
          inArray(jobs.status, ["failed", "succeeded", "canceled"]),
        ),
      )
      .returning({ id: jobs.id });

    const [inserted] = revived
      ? []
      : await tx
          .insert(jobs)
          .values({
            uuid: randomUUID(),
            type: "storage_object_delete",
            payload_json: JSON.stringify({
              fileUuid: params.uuid,
              orgUuid: params.orgUuid,
            }),
            max_attempts: params.maxAttempts ?? 10,
            dedupe_key: dedupeKey,
            subject_user_uuid: file.user_uuid,
            subject_org_uuid: params.orgUuid,
          })
          .onConflictDoNothing({ target: jobs.dedupe_key })
          .returning({ id: jobs.id });

    return { file, queued: Boolean(revived ?? inserted) };
  });
}

export async function countFilesByOrg(orgUuid: string): Promise<number> {
  return db().$count(files, scopedToOrg(files.org_uuid, orgUuid));
}

/**
 * Total bytes an organization is currently storing, for plan quota checks.
 *
 * Only uploading, active, and deleting rows reserve allowance. A failed or
 * deleted row owns no object; counting it would let an abandoned presign consume
 * quota forever or make a completed deletion free no space.
 */
export async function sumFileBytesByOrg(orgUuid: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<string | null>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(
      and(
        scopedToOrg(files.org_uuid, orgUuid),
        inArray(files.status, ["uploading", "active", "deleting"]),
      ),
    );

  // Postgres sums bigint-safe and the driver hands it back as a string.
  return Number(row?.total ?? 0);
}

export async function listStaleUploadingFiles(params: {
  cutoff: Date;
  orgUuid?: string;
  limit?: number;
}): Promise<Array<typeof files.$inferSelect>> {
  const predicates = [
    eq(files.status, "uploading"),
    lt(files.created_at, params.cutoff),
  ];

  if (params.orgUuid) {
    predicates.push(scopedToOrg(files.org_uuid, params.orgUuid));
  }

  return db()
    .select()
    .from(files)
    .where(and(...predicates))
    .orderBy(files.created_at)
    .limit(params.limit ?? 100);
}
