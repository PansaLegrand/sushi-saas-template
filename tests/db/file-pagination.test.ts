/** Real ordering and tenant scope must survive pagination ties. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db } from "@/db";
import { files } from "@/db/schema";
import { listFilesPageByOrg } from "@/models/file";
import { describeDb, useCleanDatabase } from "./setup";
describeDb("file pagination", () => {
  useCleanDatabase();
  it("returns older rows without duplicates or another tenant's files", async () => {
    const org = randomUUID();
    const rows = [org, org, org, randomUUID()].map((org_uuid, index) => ({
      uuid: randomUUID(),
      org_uuid,
      user_uuid: randomUUID(),
      provider: "s3",
      bucket: "private",
      key: String(index),
      size: 10,
      status: "active" as const,
      created_at: new Date("2026-01-01"),
    }));
    await db().insert(files).values(rows);
    const first = await listFilesPageByOrg(org, 1, 2);
    const second = await listFilesPageByOrg(org, 2, 2);
    expect(first.items.map((row) => row.uuid)).toEqual([
      rows[2].uuid,
      rows[1].uuid,
    ]);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((row) => row.uuid)).toEqual([rows[0].uuid]);
    expect(second.hasMore).toBe(false);
  });
});
