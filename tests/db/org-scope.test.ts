/**
 * Database tier: the org-scope backfill and the scope predicate.
 *
 * Migration 0014 is the riskiest statement in the tenancy work: it decides,
 * once, which organization every pre-existing row belongs to. Getting it wrong
 * does not throw — it silently files a user's data under someone else's tenant,
 * and nothing notices until a customer sees it.
 *
 * So these tests execute the shipped migration file rather than a copy, against
 * seeded rows in every table it touches.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { credits, files, orders, subscriptions, tasks, users } from "@/db/schema";
import { scopedToOrg } from "@/models/organization";
import { ensurePersonalOrganization } from "@/services/organizations";

useCleanDatabase();

async function userWithOrg(email = `scope-${randomUUID()}@test.dev`) {
  const user = {
    id: randomUUID(),
    uuid: randomUUID(),
    email,
    signin_provider: "credential",
  } satisfies typeof users.$inferInsert;

  await db().insert(users).values(user);
  const org = await ensurePersonalOrganization({ id: user.id, email });

  return { user, org };
}

/**
 * The tables 0014 backfills, and whose `org_uuid` 0015 later makes mandatory.
 */
const SCOPED_TABLES = [
  "apikeys",
  "credits",
  "files",
  "orders",
  "reservations",
  "subscriptions",
  "tasks",
] as const;

/**
 * Recreate the schema as it stood between migrations 0013 and 0015.
 *
 * 0014 exists to fill a column that was nullable at the time it ran, and 0015
 * has since made that column NOT NULL — so the current schema cannot express
 * the state 0014 was written for. Dropping the constraint for the duration of
 * the test is the only way to exercise the real migration rather than a
 * paraphrase of it, and restoring it afterwards keeps the constraint under test
 * everywhere else in the file.
 */
async function withNullableOrgScope<T>(fn: () => Promise<T>): Promise<T> {
  for (const table of SCOPED_TABLES) {
    await db().execute(
      sql.raw(`alter table "${table}" alter column "org_uuid" drop not null`)
    );
  }

  try {
    return await fn();
  } finally {
    for (const table of SCOPED_TABLES) {
      await db().execute(
        sql.raw(`update "${table}" set "org_uuid" = 'orphan-cleanup' where "org_uuid" is null`)
      );
      await db().execute(
        sql.raw(`alter table "${table}" alter column "org_uuid" set not null`)
      );
    }
  }
}

/**
 * Run the real migration. A data migration verified by re-implementing its
 * logic in the test proves only that two pieces of SQL agree with each other.
 */
async function runBackfill() {
  const file = join(__dirname, "../../src/db/migrations/0014_backfill_org_scope.sql");
  const body = readFileSync(file, "utf8");

  for (const statement of body.split("--> statement-breakpoint")) {
    if (statement.trim()) await db().execute(sql.raw(statement));
  }
}

describeDb("org scope backfill (real database)", () => {
  it("files every table's rows under the owner's personal org", async () => {
    await withNullableOrgScope(async () => {
    const { user, org } = await userWithOrg();

    await db().insert(files).values({
      uuid: randomUUID(),
      user_uuid: user.uuid,
      bucket: "b",
      key: `k-${randomUUID()}`,
    } as typeof files.$inferInsert);

    await db().insert(tasks).values({
      uuid: randomUUID(),
      user_uuid: user.uuid,
    } as typeof tasks.$inferInsert);

    // Cast because these rows deliberately omit `org_uuid`: they stand in for
    // rows written before tenancy existed, which is exactly what 0014 fixes.
    await db().insert(credits).values({
      trans_no: randomUUID(),
      user_uuid: user.uuid,
      trans_type: "new_user",
      credits: 10,
    } as typeof credits.$inferInsert);

    await db().insert(orders).values({
      order_no: randomUUID(),
      user_uuid: user.uuid,
      amount: 100,
      status: "paid",
      credits: 0,
    } as typeof orders.$inferInsert);

    await db().insert(subscriptions).values({
      uuid: randomUUID(),
      user_uuid: user.uuid,
      stripe_subscription_id: randomUUID(),
      tier: "plus",
      status: "active",
    } as typeof subscriptions.$inferInsert);

    await runBackfill();

    for (const table of [files, tasks, credits, orders, subscriptions]) {
      const rows = await db()
        .select({ org_uuid: table.org_uuid })
        .from(table)
        .where(eq(table.user_uuid, user.uuid));

      expect(rows.length, `${table}`).toBeGreaterThan(0);
      for (const row of rows) expect(row.org_uuid).toBe(org.uuid);
    }
    });
  });

  it("never attaches one user's rows to another user's org", async () => {
    await withNullableOrgScope(async () => {
    const a = await userWithOrg();
    const b = await userWithOrg();

    await db().insert(credits).values({
      trans_no: randomUUID(),
      user_uuid: a.user.uuid,
      trans_type: "new_user",
      credits: 10,
    } as typeof credits.$inferInsert);

    await runBackfill();

    const leaked = await db()
      .select()
      .from(credits)
      .where(eq(credits.org_uuid, b.org.uuid));

    expect(leaked).toHaveLength(0);
    });
  });

  it("is idempotent and never reassigns a scoped row", async () => {
    await withNullableOrgScope(async () => {
    const { user, org } = await userWithOrg();

    await db().insert(tasks).values({
      uuid: randomUUID(),
      user_uuid: user.uuid,
    } as typeof tasks.$inferInsert);

    await runBackfill();
    await runBackfill();

    const rows = await db()
      .select({ org_uuid: tasks.org_uuid })
      .from(tasks)
      .where(eq(tasks.user_uuid, user.uuid));

    expect(rows).toHaveLength(1);
    expect(rows[0].org_uuid).toBe(org.uuid);
    });
  });

  it("leaves rows whose owner no longer exists unscoped", async () => {
    await withNullableOrgScope(async () => {
    // Surfacing orphans beats guessing an owner for them. The NOT NULL
    // migration that follows is where they have to be dealt with explicitly.
    await db().insert(credits).values({
      trans_no: randomUUID(),
      user_uuid: "deleted-user-uuid",
      trans_type: "new_user",
      credits: 10,
    } as typeof credits.$inferInsert);

    await runBackfill();

    const [row] = await db()
      .select({ org_uuid: credits.org_uuid })
      .from(credits)
      .where(eq(credits.user_uuid, "deleted-user-uuid"));

    expect(row.org_uuid).toBeNull();
    });
  });
});

describeDb("org scope NOT NULL migration (real database)", () => {
  async function runNotNull() {
    const file = join(__dirname, "../../src/db/migrations/0015_org_scope_not_null.sql");
    const body = readFileSync(file, "utf8");

    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim()) await db().execute(sql.raw(statement));
    }
  }

  it("names the tables still holding unscoped rows instead of failing bare", async () => {
    // A bare `SET NOT NULL` aborts with "column contains null values" and no
    // indication of which table or how many rows. Whoever hits this is mid
    // deploy; the message is the entire remedy.
    const error = await withNullableOrgScope(async () => {
      await db()
        .insert(credits)
        .values({
          trans_no: randomUUID(),
          user_uuid: "no-such-user",
          trans_type: "new_user",
          credits: 10,
        } as typeof credits.$inferInsert);

      return runNotNull().catch((e) => e);
    });

    expect(error).toBeInstanceOf(Error);

    // Drizzle wraps the driver error, so the RAISE text is on `cause`.
    const cause = (error as { cause?: Error }).cause;
    expect(String(cause?.message)).toMatch(/credits: 1 row/);
    expect(String(cause?.message)).toMatch(/unscoped rows remain/i);
  });

  it("applies cleanly once every row is scoped", async () => {
    const { user, org } = await userWithOrg();

    await db().insert(tasks).values({
      uuid: randomUUID(),
      org_uuid: org.uuid,
      user_uuid: user.uuid,
    } as typeof tasks.$inferInsert);

    await expect(runNotNull()).resolves.not.toThrow();
  });
});

describeDb("scope predicate (real database)", () => {
  it("selects only the named organization's rows", async () => {
    const a = await userWithOrg();
    const b = await userWithOrg();

    for (const { user, org } of [a, b]) {
      await db().insert(tasks).values({
        uuid: randomUUID(),
        user_uuid: user.uuid,
        org_uuid: org.uuid,
      } as typeof tasks.$inferInsert);
    }

    const rows = await db()
      .select({ org_uuid: tasks.org_uuid })
      .from(tasks)
      .where(scopedToOrg(tasks.org_uuid, a.org.uuid));

    expect(rows).toHaveLength(1);
    expect(rows[0].org_uuid).toBe(a.org.uuid);
  });

  it("refuses an empty scope rather than matching arbitrary rows", () => {
    expect(() => scopedToOrg(tasks.org_uuid, "")).toThrow();
  });
});
