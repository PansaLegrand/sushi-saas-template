import { credits } from "@/db/schema";
import { db } from "@/db";
import { desc, eq, and, gte, asc, isNull, or, sql } from "drizzle-orm";

/** A ledger row. Exported so services can type over rows without importing the schema. */
export type CreditRow = typeof credits.$inferSelect;

export async function insertCredit(
  data: typeof credits.$inferInsert
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
  user_uuid,
  trans_type,
  credits: amount,
  trans_no,
  created_at,
}: {
  user_uuid: string;
  trans_type: string;
  credits: number;
  trans_no: string;
  created_at: Date;
}): Promise<CreditRow | undefined> {
  return db().transaction(async (tx) => {
    // Serialize spends per user. Without this, two concurrent requests can both
    // read the same balance and each insert a negative ledger row.
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${user_uuid}, 0::bigint))
    `);

    const now = new Date();
    const ledger = await tx
      .select()
      .from(credits)
      .where(
        and(
          eq(credits.user_uuid, user_uuid),
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
        user_uuid,
        trans_type,
        credits: -Math.abs(amount),
        order_no: sourceOrderNo,
      })
      .returning();

    return credit;
  });
}

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

export async function getUserValidCredits(
  user_uuid: string
): Promise<(typeof credits.$inferSelect)[] | undefined> {
  const now = new Date();
  const data = await db()
    .select()
    .from(credits)
    .where(
      and(
        eq(credits.user_uuid, user_uuid),
        or(isNull(credits.expired_at), gte(credits.expired_at, now))
      )
    )
    .orderBy(asc(credits.expired_at));

  return data;
}

/**
 * Every ledger row for a user, newest first, unpaginated.
 *
 * Balance is the sum of the whole ledger, so anything computing it must see all
 * rows — `getCreditsByUserUuid` caps at 50 and would silently under-report for
 * an active account.
 */
export async function listAllCreditsByUserUuid(
  user_uuid: string
): Promise<CreditRow[]> {
  return db()
    .select()
    .from(credits)
    .where(eq(credits.user_uuid, user_uuid))
    .orderBy(desc(credits.created_at));
}

/** Paginated view for the ledger UI. Do not use for balance arithmetic. */
export async function getCreditsByUserUuid(
  user_uuid: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof credits.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(credits)
    .where(eq(credits.user_uuid, user_uuid))
    .orderBy(desc(credits.created_at))
    .limit(limit)
    .offset((page - 1) * limit);

  return data;
}
