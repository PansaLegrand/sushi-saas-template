import { credits } from "@/db/schema";
import { db } from "@/db";
import { desc, eq, and, gte, asc, isNull, or, sql } from "drizzle-orm";

import { scopedToOrg } from "./organization";

/** A ledger row. Exported so services can type over rows without importing the schema. */
export type CreditRow = typeof credits.$inferSelect;

/**
 * The credit ledger, pooled at the organization.
 *
 * Two columns, two different questions, and conflating them is the mistake this
 * file exists to prevent:
 *
 *   org_uuid  — whose balance this row moves. All arithmetic keys on it.
 *   user_uuid — which member did it. Never used for arithmetic.
 *
 * `user_uuid` is carried on every row even though nothing reads it for balance
 * purposes, because per-member quotas and usage reporting cannot be
 * reconstructed after the fact. It costs one column now and is impossible to
 * backfill later.
 */

/** `org_uuid` is required: a ledger row outside a balance is money nobody owns. */
export type CreditInsert = typeof credits.$inferInsert & { org_uuid: string };

export async function insertCredit(
  data: CreditInsert
): Promise<typeof credits.$inferSelect | undefined> {
  if (data.created_at && typeof data.created_at === "string") {
    data.created_at = new Date(data.created_at);
  }
  if (data.expired_at && typeof data.expired_at === "string") {
    data.expired_at = new Date(data.expired_at);
  }

  const [credit] = await db().insert(credits).values(data).returning();

  return credit;
}

export async function insertSpendCreditIfSufficient({
  org_uuid,
  user_uuid,
  trans_type,
  credits: amount,
  trans_no,
  created_at,
}: {
  org_uuid: string;
  user_uuid: string;
  trans_type: string;
  credits: number;
  trans_no: string;
  created_at: Date;
}): Promise<CreditRow | undefined> {
  return db().transaction(async (tx) => {
    // Serialize spends per ORGANIZATION, not per user.
    //
    // This lock used to key on `user_uuid`, which was correct while a balance
    // belonged to one person. Pooling the balance changed the invariant: two
    // members of the same org spending at the same time would take two
    // different locks, both read the same balance, and both succeed — spending
    // the same credits twice and driving the org negative. The lock must cover
    // exactly what the balance covers.
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${org_uuid}, 0::bigint))
    `);

    const now = new Date();
    const ledger = await tx
      .select()
      .from(credits)
      .where(
        and(
          scopedToOrg(credits.org_uuid, org_uuid),
          or(isNull(credits.expired_at), gte(credits.expired_at, now))
        )
      )
      .orderBy(asc(credits.expired_at), asc(credits.created_at), asc(credits.id));

    let balance = 0;
    let sourceOrderNo = "";
    let sourceExpiry: Date | null = null;
    const buckets = new Map<
      string,
      { credits: number; orderNo: string; expiry: Date | null }
    >();

    for (const credit of ledger) {
      balance += credit.credits;

      const orderNo = credit.order_no ?? "";
      const expiry = credit.expired_at ?? null;
      const key = `${expiry?.getTime() ?? "never"}:${orderNo}`;
      const bucket = buckets.get(key) ?? { credits: 0, orderNo, expiry };
      bucket.credits += credit.credits;
      buckets.set(key, bucket);
    }

    if (balance < amount) {
      return undefined;
    }

    let accumulated = 0;
    for (const bucket of buckets.values()) {
      if (bucket.credits <= 0) continue;
      accumulated += bucket.credits;

      if (accumulated >= amount) {
        sourceOrderNo = bucket.orderNo;
        sourceExpiry = bucket.expiry;
        break;
      }
    }

    const [credit] = await tx
      .insert(credits)
      .values({
        trans_no,
        created_at,
        expired_at: sourceExpiry,
        org_uuid,
        // The actor. Recorded, never summed.
        user_uuid,
        trans_type,
        credits: -Math.abs(amount),
        order_no: sourceOrderNo,
      })
      .returning();

    return credit;
  });
}

/**
 * Lookup by `trans_no`, which is globally unique.
 *
 * Unscoped on purpose: this resolves a transaction the caller already holds an
 * identifier for — a refund reconciling against a spend, or a retried job
 * checking whether it already ran. Callers that go on to act on the row must
 * compare its `org_uuid` against their own context.
 */
export async function findCreditByTransNo(
  trans_no: string
): Promise<typeof credits.$inferSelect | undefined> {
  const [credit] = await db()
    .select()
    .from(credits)
    .where(eq(credits.trans_no, trans_no))
    .limit(1);

  return credit;
}

/** Lookup by `order_no`, also globally unique. Same caveat as above. */
export async function findCreditByOrderNo(
  order_no: string
): Promise<typeof credits.$inferSelect | undefined> {
  const [credit] = await db()
    .select()
    .from(credits)
    .where(eq(credits.order_no, order_no))
    .limit(1);

  return credit;
}

export async function getOrgValidCredits(
  orgUuid: string
): Promise<(typeof credits.$inferSelect)[] | undefined> {
  const now = new Date();
  const data = await db()
    .select()
    .from(credits)
    .where(
      and(
        scopedToOrg(credits.org_uuid, orgUuid),
        or(isNull(credits.expired_at), gte(credits.expired_at, now))
      )
    )
    .orderBy(asc(credits.expired_at));

  return data;
}

/**
 * Every ledger row for an organization, newest first, unpaginated.
 *
 * Balance is the sum of the whole ledger, so anything computing it must see all
 * rows — `getCreditsByOrg` caps at 50 and would silently under-report for an
 * active account.
 */
export async function listAllCreditsByOrg(orgUuid: string): Promise<CreditRow[]> {
  return db()
    .select()
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, orgUuid))
    .orderBy(desc(credits.created_at));
}

/** Paginated view for the ledger UI. Do not use for balance arithmetic. */
export async function getCreditsByOrg(
  orgUuid: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof credits.$inferSelect)[] | undefined> {
  return db()
    .select()
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, orgUuid))
    .orderBy(desc(credits.created_at))
    .limit(limit)
    .offset((page - 1) * limit);
}
