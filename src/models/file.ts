import { db } from "@/db";
import { files } from "@/db/schema";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";

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
  data: FileInsert
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db().insert(files).values(data).returning();
  return row;
}

export async function findFileByUuid(
  uuid: string,
  orgUuid: string
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
  patch: Partial<typeof files.$inferInsert>
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ ...patch, updated_at: new Date() })
    .where(and(eq(files.uuid, uuid), scopedToOrg(files.org_uuid, orgUuid)))
    .returning();
  return row;
}

export async function listFilesByOrg(
  orgUuid: string,
  page: number = 1,
  limit: number = 50,
  includeDeleted = false
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
  orgUuid: string
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ status: "deleted", deleted_at: new Date(), updated_at: new Date() })
    .where(and(eq(files.uuid, uuid), scopedToOrg(files.org_uuid, orgUuid)))
    .returning();
  return row;
}

export async function countFilesByOrg(orgUuid: string): Promise<number> {
  return db().$count(files, scopedToOrg(files.org_uuid, orgUuid));
}

/**
 * Total bytes an organization is currently storing, for plan quota checks.
 *
 * Deleted files are excluded — a soft-deleted row is no longer occupying the
 * allowance, and counting it would mean deleting a file did not free any space,
 * which is the kind of thing that generates a support ticket rather than a bug
 * report.
 */
export async function sumFileBytesByOrg(orgUuid: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<string | null>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(and(scopedToOrg(files.org_uuid, orgUuid), ne(files.status, "deleted")));

  // Postgres sums bigint-safe and the driver hands it back as a string.
  return Number(row?.total ?? 0);
}

export async function markStaleUploadingFilesFailed(params: {
  cutoff: Date;
  orgUuid?: string;
}): Promise<number> {
  const predicates = [
    eq(files.status, "uploading"),
    lt(files.created_at, params.cutoff),
  ];

  if (params.orgUuid) {
    predicates.push(scopedToOrg(files.org_uuid, params.orgUuid));
  }

  const rows = await db()
    .update(files)
    .set({ status: "failed", updated_at: new Date() })
    .where(and(...predicates))
    .returning({ id: files.id });

  return rows.length;
}
