import { credits } from "@/db/schema";
import { db } from "@/db";
import { desc, eq, and, gte, asc, inArray, isNull, or, sql } from "drizzle-orm";

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

/**
 * Who caused a movement. Namespaced so the prefix alone answers "was this us or
 * a customer paying", and typed as a template union so a bare string like
 * `"admin"` will not compile — an unnamespaced actor is the one value that would
 * make the column useless.
 */
export type CreditActor =
  /** A Stripe webhook, i.e. money the customer actually handed over. */
  | `stripe:${string}`
  /** An admin acting on someone else's balance. The uuid is the admin's. */
  | `admin:${string}`
  /** A member acting on their own org — a spend, or a self-serve grant. */
  | `user:${string}`
  /** Us: a signup bonus, a task refund, a migration. */
  | `system:${string}`;

/**
 * `org_uuid` is required: a ledger row outside a balance is money nobody owns.
 * `actor` is required for the same reason — a movement nobody caused cannot be
 * audited, and it is not backfillable once written.
 *
 * `balance_after` is *omitted* rather than optional. It is derived, and only
 * correct when computed under the org lock below, so a caller must not be able
 * to supply one. Every write in this file computes it.
 */
export type CreditInsert = Omit<typeof credits.$inferInsert, "balance_after"> & {
  org_uuid: string;
  actor: CreditActor;
};

/** An open transaction, as handed to the callback of `db().transaction()`. */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Take the per-organization lock and return the ledger total under it.
 *
 * Must be called inside a transaction — `pg_advisory_xact_lock` releases on
 * commit, and a lock that has already been released does not serialize the
 * insert it was taken for.
 *
 * The lock keys on the organization because that is what the balance covers.
 * Two members of one org writing at once would otherwise both read the same
 * total and write the same `balance_after`, which is the exact inconsistency the
 * column exists to expose.
 *
 * The sum is over *every* row, including expired grants. See the note on
 * `balance_after` in the schema: a spend-aware total would drift from the ledger
 * by design and make real drift undetectable.
 */
export async function lockOrgAndSumLedger(
  tx: Tx,
  org_uuid: string
): Promise<number> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${org_uuid}, 0::bigint))
  `);

  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${credits.credits}), 0)::int` })
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, org_uuid));

  return row?.total ?? 0;
}

export async function insertCredit(
  data: CreditInsert
): Promise<typeof credits.$inferSelect | undefined> {
  if (data.created_at && typeof data.created_at === "string") {
    data.created_at = new Date(data.created_at);
  }
  if (data.expired_at && typeof data.expired_at === "string") {
    data.expired_at = new Date(data.expired_at);
  }

  // A transaction for a single insert, because `balance_after` makes it a
  // read-then-write: the total has to be read under a lock that is still held
  // when the row lands, or two concurrent grants stamp the same balance.
  return db().transaction(async (tx) => {
    const balanceBefore = await lockOrgAndSumLedger(tx, data.org_uuid);

    const [credit] = await tx
      .insert(credits)
      .values({ ...data, balance_after: balanceBefore + data.credits })
      .returning();

    return credit;
  });
}

/**
 * What a spend attempt did, and — when it did nothing — why.
 *
 * `available` is the balance the refusal was actually based on: computed inside
 * the transaction, under the advisory lock, from the same rows that failed to
 * cover the cost. Reading it again afterwards would be both an extra query and
 * a slightly different number, since a concurrent grant can land in between.
 * Callers turn it into "you need 4 more credits", which is only honest if it is
 * the number that did the refusing.
 */
export type SpendOutcome =
  | { ok: true; row: CreditRow }
  | { ok: false; available: number };

export async function insertSpendCreditIfSufficient({
  org_uuid,
  user_uuid,
  trans_type,
  credits: amount,
  trans_no,
  created_at,
  actor,
  metadata_json,
}: {
  org_uuid: string;
  user_uuid: string;
  trans_type: string;
  credits: number;
  trans_no: string;
  created_at: Date;
  actor: CreditActor;
  metadata_json?: string | null;
}): Promise<SpendOutcome> {
  return db().transaction(async (tx) => {
    // Serialize spends per ORGANIZATION, not per user.
    //
    // This lock used to key on `user_uuid`, which was correct while a balance
    // belonged to one person. Pooling the balance changed the invariant: two
    // members of the same org spending at the same time would take two
    // different locks, both read the same balance, and both succeed — spending
    // the same credits twice and driving the org negative. The lock must cover
    // exactly what the balance covers.
    //
    // The same lock now also serializes `balance_after`. The ledger total it
    // returns is *not* the spendable balance computed below — expired grants
    // count toward the audit trail and not toward what can be spent — so both
    // are needed, and conflating them would either strand expired credits in
    // the balance or make the audit column drift.
    const ledgerTotal = await lockOrgAndSumLedger(tx, org_uuid);

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
      // Clamped: a balance can go negative through a refund of an expired
      // grant, and "you have -3 credits" is not a sentence worth showing.
      return { ok: false, available: Math.max(balance, 0) };
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

    const spent = -Math.abs(amount);

    const [credit] = await tx
      .insert(credits)
      .values({
        trans_no,
        created_at,
        expired_at: sourceExpiry,
        org_uuid,
        // Which member this is attributed to. Recorded, never summed.
        user_uuid,
        trans_type,
        credits: spent,
        order_no: sourceOrderNo,
        actor,
        metadata_json: metadata_json ?? null,
        balance_after: ledgerTotal + spent,
      })
      .returning();

    if (!credit) {
      // Unreachable: `insert ... returning` returns the row it wrote. Worth
      // saying out loud anyway, because the old signature folded this case into
      // "insufficient" — which would have told a user with money that they were
      // broke, and hidden a real failure behind a plausible one.
      throw new Error(`spend insert returned no row for org ${org_uuid}`);
    }

    return { ok: true, row: credit };
  });
}

/**
 * Ledger rows whose `balance_after` disagrees with the ledger.
 *
 * This is what the column was added for. The invariant is that within an
 * organization, ordered by insertion, `balance_after` equals the running sum of
 * `credits` — so a row where it does not means two writes computed the total
 * against the same stale read, which no constraint can catch because no
 * constraint was violated.
 *
 * Computed with a window function rather than in TypeScript: the whole point is
 * to compare against what the database actually holds, and pulling every ledger
 * row into the process to add them up would not scale past a small tenant.
 *
 * Rows with a null `balance_after` are skipped — they predate migration 0018 and
 * have no claim to check. They still *count toward* the running sum, which is
 * correct: `lockOrgAndSumLedger` sums every row, so the first row written after
 * 0018 legitimately carries a total that includes the untracked history.
 */
export async function findLedgerBalanceDrift(limit = 100): Promise<
  {
    id: number;
    trans_no: string;
    org_uuid: string;
    credits: number;
    balance_after: number | null;
    expected_balance_after: number;
  }[]
> {
  const rows = await db().execute(sql`
    select id, trans_no, org_uuid, credits, balance_after, expected_balance_after
    from (
      select
        id,
        trans_no,
        org_uuid,
        credits,
        balance_after,
        sum(credits) over (partition by org_uuid order by id)::int
          as expected_balance_after
      from credits
    ) as running
    where balance_after is not null
      and balance_after <> expected_balance_after
    order by org_uuid, id
    limit ${limit}
  `);

  return rows as unknown as {
    id: number;
    trans_no: string;
    org_uuid: string;
    credits: number;
    balance_after: number | null;
    expected_balance_after: number;
  }[];
}

/**
 * The ledger rows for a page of orders, in one query.
 *
 * Backs the console's "did this order's credits actually land" column, which is
 * the per-row version of the check reconciliation runs in bulk. Fetched
 * separately rather than as a LEFT JOIN on the order list: an order with two
 * ledger rows would duplicate the order in a joined result and quietly corrupt
 * the pagination, and "two grants for one order" is exactly the anomaly this is
 * meant to reveal rather than hide.
 *
 * Unscoped, like the other `trans_no`/`order_no` lookups here — the caller is
 * the admin console, which is cross-tenant by design.
 */
export async function findCreditsByOrderNos(
  orderNos: string[]
): Promise<(typeof credits.$inferSelect)[]> {
  if (orderNos.length === 0) return [];

  return db().select().from(credits).where(inArray(credits.order_no, orderNos));
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
