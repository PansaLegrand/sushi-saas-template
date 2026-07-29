import { credits } from "@/db/schema";
import { db } from "@/db";
import { desc, eq, asc, inArray, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors/app-error";

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
export type CreditInsert = Omit<
  typeof credits.$inferInsert,
  "balance_after"
> & {
  org_uuid: string;
  actor: CreditActor;
};

/**
 * A currently unconsumed portion of one positive ledger row.
 *
 * Buckets remain tied to their grant row so an expiring-soon view can show the
 * amount that is actually left, rather than the grant's original face value.
 */
export type CreditBucketBalance = {
  source: CreditRow;
  remaining: number;
};

/**
 * One physical debit/refund part.
 *
 * FEFO spends can cross expiration boundaries. Each allocation becomes its own
 * immutable ledger row so the debit expires with the grant it consumed.
 */
export type CreditAllocation = {
  credits: number;
  expiredAt: Date | null;
  orderNo: string;
  sourceTransNos: string[];
};

export type CreditBalanceSnapshot = {
  /** Credits that can be spent at `asOf`. Always non-negative. */
  available: number;
  /** Face value of positive rows that are still active at `asOf`. */
  activeGranted: number;
  /** Active grant value already consumed. */
  activeConsumed: number;
  /** Unused credits whose grant expiration has passed. */
  expired: number;
  /** Every positive row's remaining amount, ordered FEFO. */
  buckets: CreditBucketBalance[];
  /** Historical FEFO allocation for each physical debit row. */
  allocationsByTransNo: Map<string, CreditAllocation[]>;
};

export type CreditLedgerSnapshot = {
  /** Newest-first immutable rows. Admin/audit surfaces intentionally use these. */
  rows: CreditRow[];
  /**
   * Newest-first customer view.
   *
   * Physical FEFO parts are collapsed into one logical movement, and the
   * private grouping metadata is removed. Pagination must happen against this
   * list so one customer action consumes one ledger slot.
   */
  logicalRows: CreditRow[];
  balance: CreditBalanceSnapshot;
};

const FEFO_METADATA_KEY = "__credit_fefo";
const FEFO_METADATA_VERSION = 1;

type FefoMetadata = {
  version: number;
  root_trans_no: string;
  part_trans_nos: string[];
  part_index: number;
  source_trans_nos: string[];
};

function rowTime(row: CreditRow): Date {
  // `created_at` is nullable for legacy rows. Their identity id still gives us
  // insertion order; the epoch fallback keeps an old spend eligible to consume
  // the grants that preceded it instead of pretending it happened today.
  return row.created_at ?? new Date(0);
}

function isActiveAt(expiredAt: Date | null, at: Date): boolean {
  // Expiration is an instant, not the end of a fuzzy window: at exactly
  // `expired_at` the credits are no longer spendable.
  return !expiredAt || expiredAt.getTime() > at.getTime();
}

function compareBucketsFefo(
  left: CreditBucketBalance,
  right: CreditBucketBalance,
): number {
  const leftExpiry =
    left.source.expired_at?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightExpiry =
    right.source.expired_at?.getTime() ?? Number.POSITIVE_INFINITY;

  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;

  const createdDiff =
    rowTime(left.source).getTime() - rowTime(right.source).getTime();
  if (createdDiff !== 0) return createdDiff;

  return left.source.id - right.source.id;
}

function insertBucketFefo(
  buckets: CreditBucketBalance[],
  bucket: CreditBucketBalance,
): void {
  let low = 0;
  let high = buckets.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareBucketsFefo(buckets[middle]!, bucket) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  buckets.splice(low, 0, bucket);
}

function appendAllocation(
  allocations: CreditAllocation[],
  bucket: CreditBucketBalance,
  amount: number,
): void {
  const expiredAt = bucket.source.expired_at ?? null;
  const orderNo = bucket.source.order_no ?? "";
  const existing = allocations.find(
    (allocation) =>
      (allocation.expiredAt?.getTime() ?? null) ===
        (expiredAt?.getTime() ?? null) && allocation.orderNo === orderNo,
  );

  if (existing) {
    existing.credits += amount;
    if (!existing.sourceTransNos.includes(bucket.source.trans_no)) {
      existing.sourceTransNos.push(bucket.source.trans_no);
    }
    return;
  }

  allocations.push({
    credits: amount,
    expiredAt,
    orderNo,
    sourceTransNos: [bucket.source.trans_no],
  });
}

function mergeAllocation(
  allocations: CreditAllocation[],
  addition: CreditAllocation,
): void {
  const existing = allocations.find(
    (allocation) =>
      (allocation.expiredAt?.getTime() ?? null) ===
        (addition.expiredAt?.getTime() ?? null) &&
      allocation.orderNo === addition.orderNo,
  );

  if (!existing) {
    allocations.push({
      ...addition,
      sourceTransNos: [...addition.sourceTransNos],
    });
    return;
  }

  existing.credits += addition.credits;
  for (const sourceTransNo of addition.sourceTransNos) {
    if (!existing.sourceTransNos.includes(sourceTransNo)) {
      existing.sourceTransNos.push(sourceTransNo);
    }
  }
}

function consumeBucketsFefo(
  buckets: CreditBucketBalance[],
  amount: number,
  at: Date,
): { allocations: CreditAllocation[]; unallocated: number } {
  const allocations: CreditAllocation[] = [];
  let unallocated = amount;

  for (const bucket of buckets) {
    if (unallocated <= 0) break;
    if (bucket.remaining <= 0) continue;
    if (!isActiveAt(bucket.source.expired_at ?? null, at)) continue;

    const consumed = Math.min(bucket.remaining, unallocated);
    bucket.remaining -= consumed;
    unallocated -= consumed;
    appendAllocation(allocations, bucket, consumed);
  }

  return { allocations, unallocated };
}

/**
 * Rebuild the spendable state from immutable ledger facts.
 *
 * Every debit is replayed FEFO at the instant it was written: the grant with
 * the nearest expiration is consumed first, ties go to the oldest grant, and
 * never-expiring grants come last. Replaying instead of trusting a debit's
 * `expired_at` also repairs reads of legacy single-row spends that crossed more
 * than one expiration bucket.
 *
 * The same function backs the write guard and customer/admin balance views.
 * That makes "available" one definition rather than two pieces of arithmetic
 * that can drift apart.
 */
export function calculateCreditBalance(
  rows: CreditRow[],
  asOf: Date = new Date(),
): CreditBalanceSnapshot {
  const ordered = [...rows]
    .filter(
      (row) => !row.created_at || row.created_at.getTime() <= asOf.getTime(),
    )
    .sort((left, right) => left.id - right.id);

  const buckets: CreditBucketBalance[] = [];
  const allocationsByTransNo = new Map<string, CreditAllocation[]>();
  let unallocatedDebt = 0;

  for (const row of ordered) {
    if (row.credits > 0) {
      const bucket: CreditBucketBalance = {
        source: row,
        remaining: row.credits,
      };

      // A malformed/legacy negative balance remains debt. A later valid grant
      // offsets it, preserving the old SUM(credits) behaviour without allowing
      // a negative spendable balance.
      if (
        unallocatedDebt > 0 &&
        isActiveAt(bucket.source.expired_at ?? null, rowTime(row))
      ) {
        const offset = Math.min(bucket.remaining, unallocatedDebt);
        bucket.remaining -= offset;
        unallocatedDebt -= offset;
      }

      insertBucketFefo(buckets, bucket);
      continue;
    }

    if (row.credits < 0) {
      const result = consumeBucketsFefo(
        buckets,
        Math.abs(row.credits),
        rowTime(row),
      );
      allocationsByTransNo.set(row.trans_no, result.allocations);
      unallocatedDebt += result.unallocated;
    }
  }

  let available = 0;
  let activeGranted = 0;
  let expired = 0;

  for (const row of ordered) {
    if (row.credits > 0 && isActiveAt(row.expired_at ?? null, asOf)) {
      activeGranted += row.credits;
    }
  }

  for (const bucket of buckets) {
    if (isActiveAt(bucket.source.expired_at ?? null, asOf)) {
      available += bucket.remaining;
    } else {
      // "Expired" means credits the customer actually lost to expiry, not the
      // original face value of a grant they may already have used.
      expired += bucket.remaining;
    }
  }

  available = Math.max(available, 0);

  return {
    available,
    activeGranted,
    activeConsumed: Math.max(activeGranted - available, 0),
    expired,
    buckets,
    allocationsByTransNo,
  };
}

function parseMetadataObject(
  metadataJson: string | null | undefined,
): Record<string, unknown> {
  if (!metadataJson) return {};

  try {
    const parsed = JSON.parse(metadataJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Service callers always provide serialized objects. Preserve an unexpected
    // legacy value below instead of silently deleting evidence.
  }

  return { legacy_metadata_json: metadataJson };
}

function metadataForFefoPart(input: {
  metadataJson?: string | null;
  rootTransNo: string;
  partTransNos: string[];
  partIndex: number;
  sourceTransNos: string[];
}): string | null {
  if (input.partTransNos.length === 1) {
    return input.metadataJson ?? null;
  }

  return JSON.stringify({
    ...parseMetadataObject(input.metadataJson),
    [FEFO_METADATA_KEY]: {
      version: FEFO_METADATA_VERSION,
      root_trans_no: input.rootTransNo,
      part_trans_nos: input.partTransNos,
      part_index: input.partIndex,
      source_trans_nos: input.sourceTransNos,
    } satisfies FefoMetadata,
  });
}

function parseFefoMetadata(metadata: unknown): FefoMetadata | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const candidate = metadata as Partial<FefoMetadata>;
  if (
    candidate.version !== FEFO_METADATA_VERSION ||
    typeof candidate.root_trans_no !== "string" ||
    !Array.isArray(candidate.part_trans_nos) ||
    candidate.part_trans_nos.length === 0 ||
    candidate.part_trans_nos[0] !== candidate.root_trans_no ||
    candidate.part_trans_nos.some(
      (transNo) => typeof transNo !== "string" || transNo.length === 0,
    ) ||
    new Set(candidate.part_trans_nos).size !==
      candidate.part_trans_nos.length ||
    !Number.isInteger(candidate.part_index) ||
    candidate.part_index! < 0 ||
    candidate.part_index! >= candidate.part_trans_nos.length ||
    !Array.isArray(candidate.source_trans_nos) ||
    candidate.source_trans_nos.some(
      (transNo) => typeof transNo !== "string" || transNo.length === 0,
    )
  ) {
    return undefined;
  }

  return candidate as FefoMetadata;
}

function fefoMetadataForRow(row: CreditRow): FefoMetadata | undefined {
  const parsed = parseMetadataObject(row.metadata_json);
  return parseFefoMetadata(parsed[FEFO_METADATA_KEY]);
}

function hasFefoMetadata(row: CreditRow): boolean {
  return FEFO_METADATA_KEY in parseMetadataObject(row.metadata_json);
}

function fefoPartTransNos(root: CreditRow): string[] {
  const parsed = parseMetadataObject(root.metadata_json);
  if (!(FEFO_METADATA_KEY in parsed)) {
    return [root.trans_no];
  }

  const metadata = parseFefoMetadata(parsed[FEFO_METADATA_KEY]);
  if (!metadata || metadata.root_trans_no !== root.trans_no) {
    return [];
  }

  return metadata.part_trans_nos;
}

type ResolvedFefoGroup = {
  root: CreditRow;
  parts: CreditRow[];
};

/**
 * Validate a complete physical FEFO group already loaded by the caller.
 *
 * Metadata is deliberately treated as an index, not as trusted truth. Every
 * part has to independently agree on group identity, ordering, tenant,
 * recipient, transaction type, actor, and sign before we present it as one
 * logical movement.
 */
function resolveFefoGroup(
  seed: CreditRow,
  candidateRows: CreditRow[],
): ResolvedFefoGroup | undefined {
  const seedMetadata = fefoMetadataForRow(seed);
  if (!seedMetadata) return undefined;

  const byTransNo = new Map(
    candidateRows.map((row) => [row.trans_no, row] as const),
  );
  const root = byTransNo.get(seedMetadata.root_trans_no);
  if (!root) return undefined;

  const rootMetadata = fefoMetadataForRow(root);
  if (
    !rootMetadata ||
    rootMetadata.root_trans_no !== root.trans_no ||
    rootMetadata.part_index !== 0 ||
    rootMetadata.part_trans_nos.length !== seedMetadata.part_trans_nos.length ||
    rootMetadata.part_trans_nos.some(
      (transNo, index) => transNo !== seedMetadata.part_trans_nos[index],
    )
  ) {
    return undefined;
  }

  const parts = rootMetadata.part_trans_nos
    .map((transNo) => byTransNo.get(transNo))
    .filter((row): row is CreditRow => Boolean(row));
  if (parts.length !== rootMetadata.part_trans_nos.length) {
    return undefined;
  }

  const rootSign = Math.sign(root.credits);
  if (
    rootSign === 0 ||
    !parts.every((row, index) => {
      const metadata = fefoMetadataForRow(row);
      return (
        metadata?.root_trans_no === root.trans_no &&
        metadata.part_index === index &&
        metadata.part_trans_nos.length === rootMetadata.part_trans_nos.length &&
        metadata.part_trans_nos.every(
          (transNo, partIndex) =>
            transNo === rootMetadata.part_trans_nos[partIndex],
        ) &&
        row.org_uuid === root.org_uuid &&
        row.user_uuid === root.user_uuid &&
        row.trans_type === root.trans_type &&
        row.actor === root.actor &&
        Math.sign(row.credits) === rootSign
      );
    })
  ) {
    return undefined;
  }

  return { root, parts };
}

function sharedValue<T>(
  values: T[],
  equals: (left: T, right: T) => boolean = Object.is,
): T | null {
  const first = values[0];
  if (first === undefined) return null;
  return values.every((value) => equals(value, first)) ? first : null;
}

function metadataWithoutFefo(row: CreditRow): string | null {
  if (!hasFefoMetadata(row)) return row.metadata_json;

  const metadata = parseMetadataObject(row.metadata_json);
  delete metadata[FEFO_METADATA_KEY];
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

/**
 * Present a complete physical group as the one movement the caller initiated.
 *
 * A mixed expiration/order group has no honest single bucket value, so those
 * fields become null. `balance_after` comes from the last physical part because
 * that is the total after the whole logical movement, not midway through it.
 */
function logicalCreditRow(group: ResolvedFefoGroup): CreditRow {
  const { root, parts } = group;
  const orderNo = sharedValue(parts.map((part) => part.order_no));
  const expiredAt = sharedValue(
    parts.map((part) => part.expired_at),
    (left, right) => (left?.getTime() ?? null) === (right?.getTime() ?? null),
  );

  return {
    ...root,
    credits: parts.reduce((total, part) => total + part.credits, 0),
    order_no: orderNo,
    expired_at: expiredAt,
    balance_after: parts.at(-1)?.balance_after ?? null,
    metadata_json: metadataWithoutFefo(root),
  };
}

/**
 * Collapse valid FEFO groups without changing the immutable rows.
 *
 * Invalid/incomplete groups stay physical so the admin audit remains
 * diagnosable. Customer DTOs never serialize metadata at all, while valid
 * groups — every group produced by this model — appear exactly once.
 */
export function collapseCreditRowsToLogical(rows: CreditRow[]): CreditRow[] {
  const byTransNo = new Map(rows.map((row) => [row.trans_no, row] as const));
  const emittedRoots = new Set<string>();
  const logicalRows: CreditRow[] = [];

  for (const row of rows) {
    const metadata = fefoMetadataForRow(row);
    if (!metadata) {
      logicalRows.push(
        hasFefoMetadata(row)
          ? { ...row, metadata_json: metadataWithoutFefo(row) }
          : row,
      );
      continue;
    }

    if (emittedRoots.has(metadata.root_trans_no)) continue;

    const candidates = metadata.part_trans_nos
      .map((transNo) => byTransNo.get(transNo))
      .filter((candidate): candidate is CreditRow => Boolean(candidate));
    const group = resolveFefoGroup(row, candidates);
    if (!group) {
      logicalRows.push({ ...row, metadata_json: metadataWithoutFefo(row) });
      continue;
    }

    emittedRoots.add(metadata.root_trans_no);
    logicalRows.push(logicalCreditRow(group));
  }

  return logicalRows;
}

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
  org_uuid: string,
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
  data: CreditInsert,
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
      .where(scopedToOrg(credits.org_uuid, org_uuid))
      .orderBy(asc(credits.id));

    const snapshot = calculateCreditBalance(ledger, now);
    if (snapshot.available < amount) {
      // Clamped: a balance can go negative through a refund of an expired
      // grant, and "you have -3 credits" is not a sentence worth showing.
      return { ok: false, available: snapshot.available };
    }

    const allocation = consumeBucketsFefo(snapshot.buckets, amount, now);
    if (allocation.unallocated > 0 || allocation.allocations.length === 0) {
      // Both values come from the same snapshot under the same org lock, so
      // reaching this branch means the allocator and balance calculation have
      // diverged. Treat that as an internal failure, never as "insufficient".
      throw new AppError("CREDITS_GRANT_FAILED", {
        message: `FEFO allocation failed for org ${org_uuid}: ${allocation.unallocated} unallocated`,
      });
    }

    const partTransNos = allocation.allocations.map((_, index) =>
      index === 0 ? trans_no : `${trans_no}:part:${index + 1}`,
    );
    let runningLedgerTotal = ledgerTotal;

    const inserted = await tx
      .insert(credits)
      .values(
        allocation.allocations.map((part, index) => {
          const spent = -Math.abs(part.credits);
          runningLedgerTotal += spent;

          return {
            trans_no: partTransNos[index]!,
            created_at,
            expired_at: part.expiredAt,
            org_uuid,
            // Which member this is attributed to. Recorded, never summed.
            user_uuid,
            trans_type,
            credits: spent,
            order_no: part.orderNo,
            actor,
            metadata_json: metadataForFefoPart({
              metadataJson: metadata_json,
              rootTransNo: trans_no,
              partTransNos,
              partIndex: index,
              sourceTransNos: part.sourceTransNos,
            }),
            balance_after: runningLedgerTotal,
          };
        }),
      )
      .returning();

    const root = inserted.find((credit) => credit.trans_no === trans_no);
    if (!root || inserted.length !== allocation.allocations.length) {
      // Unreachable: `insert ... returning` returns the row it wrote. Worth
      // saying out loud anyway, because the old signature folded this case into
      // "insufficient" — which would have told a user with money that they were
      // broke, and hidden a real failure behind a plausible one.
      throw new AppError("CREDITS_GRANT_FAILED", {
        message: `spend insert returned an incomplete FEFO group for org ${org_uuid}`,
      });
    }

    return { ok: true, row: root };
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
  orderNos: string[],
): Promise<(typeof credits.$inferSelect)[]> {
  if (orderNos.length === 0) return [];

  return db().select().from(credits).where(inArray(credits.order_no, orderNos));
}

async function findPhysicalCreditByTransNo(
  trans_no: string,
): Promise<CreditRow | undefined> {
  const [credit] = await db()
    .select()
    .from(credits)
    .where(eq(credits.trans_no, trans_no))
    .limit(1);

  return credit;
}

/**
 * Lookup one logical credit movement by any of its physical transaction ids.
 *
 * `trans_no` is globally unique, but a FEFO spend/refund can have several
 * physical rows. Returning only the root row would understate its amount, so a
 * complete group is summed and returned under its root id. Private grouping
 * metadata is removed. Incomplete or contradictory groups fail closed instead
 * of being mistaken for a smaller valid movement.
 *
 * Unscoped on purpose: this resolves an identifier the caller already holds.
 * Callers that act on the result must still prove `org_uuid` ownership.
 */
export async function findCreditByTransNo(
  trans_no: string,
): Promise<CreditRow | undefined> {
  const physical = await findPhysicalCreditByTransNo(trans_no);
  if (!physical || !hasFefoMetadata(physical)) return physical;

  const metadata = fefoMetadataForRow(physical);
  if (!metadata) {
    throw new AppError("CREDITS_GRANT_FAILED", {
      message: `credit transaction ${trans_no} has invalid FEFO metadata`,
    });
  }

  const partRows = await db()
    .select()
    .from(credits)
    .where(inArray(credits.trans_no, metadata.part_trans_nos));
  const group = resolveFefoGroup(physical, partRows);
  if (!group) {
    throw new AppError("CREDITS_GRANT_FAILED", {
      message: `credit transaction ${trans_no} has an incomplete FEFO group`,
    });
  }

  return logicalCreditRow(group);
}

export type CreditSpendRefundPlan = {
  original: CreditRow;
  parts: CreditRow[];
  allocations: CreditAllocation[];
  /** False means the root named parts that are missing or no longer agree. */
  complete: boolean;
};

/**
 * Resolve a logical spend into the grant buckets a refund must restore.
 *
 * New cross-bucket spends name every physical part in the root row's private
 * metadata. A legacy spend has one row and no metadata; replaying the ledger
 * reconstructs the FEFO allocation it should always have had, so old data gets
 * the same refund semantics as new data.
 */
export async function findCreditSpendRefundPlan(
  rootTransNo: string,
): Promise<CreditSpendRefundPlan | undefined> {
  // Refund reconstruction needs the immutable root and its private grouping
  // metadata, not the sanitized logical projection returned by the public
  // transaction lookup.
  const original = await findPhysicalCreditByTransNo(rootTransNo);
  if (!original) return undefined;

  const partTransNos = fefoPartTransNos(original);
  if (partTransNos.length === 0) {
    return {
      original,
      parts: [original],
      allocations: [],
      complete: false,
    };
  }

  const partRows =
    partTransNos.length === 1
      ? [original]
      : await db()
          .select()
          .from(credits)
          .where(inArray(credits.trans_no, partTransNos));

  const byTransNo = new Map(partRows.map((row) => [row.trans_no, row]));
  const parts = partTransNos
    .map((transNo) => byTransNo.get(transNo))
    .filter((row): row is CreditRow => Boolean(row));

  const complete =
    parts.length === partTransNos.length &&
    parts.every((row, index) => {
      const metadata =
        partTransNos.length > 1 ? fefoMetadataForRow(row) : undefined;
      const groupMatches =
        partTransNos.length === 1 ||
        (metadata?.root_trans_no === original.trans_no &&
          metadata.part_index === index &&
          metadata.part_trans_nos.length === partTransNos.length &&
          metadata.part_trans_nos.every(
            (transNo, partIndex) => transNo === partTransNos[partIndex],
          ));

      return (
        groupMatches &&
        row.org_uuid === original.org_uuid &&
        row.user_uuid === original.user_uuid &&
        row.trans_type === original.trans_type &&
        row.credits < 0
      );
    });

  if (!complete) {
    return { original, parts, allocations: [], complete: false };
  }

  const ledger = await db()
    .select()
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, original.org_uuid))
    .orderBy(asc(credits.id));
  const snapshot = calculateCreditBalance(ledger);
  const allocations: CreditAllocation[] = [];

  for (const part of parts) {
    const replayed = snapshot.allocationsByTransNo.get(part.trans_no) ?? [];
    let allocated = 0;

    for (const allocation of replayed) {
      allocated += allocation.credits;
      mergeAllocation(allocations, allocation);
    }

    const missing = Math.abs(part.credits) - allocated;
    if (missing > 0) {
      // Only possible for malformed legacy rows that drove the ledger below
      // zero. Preserve the old row's expiry/order for the untraceable portion
      // so a refund still reverses the full immutable debit.
      appendAllocation(
        allocations,
        {
          source: {
            ...part,
            credits: missing,
          },
          remaining: missing,
        },
        missing,
      );
    }
  }

  return { original, parts, allocations, complete: true };
}

/**
 * Insert every refund bucket atomically and idempotently.
 *
 * The root transaction number is deterministic. The per-org lock makes the
 * read-before-insert safe for concurrent retries, while the global unique
 * index remains the final guarantee against a duplicate row.
 */
export async function insertCreditRefund(input: {
  root_trans_no: string;
  original_trans_no: string;
  original_trans_type: string;
  org_uuid: string;
  user_uuid: string;
  trans_type: string;
  allocations: CreditAllocation[];
  actor: CreditActor;
  created_at: Date;
}): Promise<CreditRow> {
  return db().transaction(async (tx) => {
    const ledgerTotal = await lockOrgAndSumLedger(tx, input.org_uuid);

    const [existing] = await tx
      .select()
      .from(credits)
      .where(eq(credits.trans_no, input.root_trans_no))
      .limit(1);
    if (existing) return existing;

    if (
      input.allocations.length === 0 ||
      input.allocations.some((allocation) => allocation.credits <= 0)
    ) {
      throw new AppError("CREDITS_GRANT_FAILED", {
        message: `refund ${input.root_trans_no} has no valid FEFO allocations`,
      });
    }

    const partTransNos = input.allocations.map((_, index) =>
      index === 0
        ? input.root_trans_no
        : `${input.root_trans_no}:part:${index + 1}`,
    );
    const baseMetadata = JSON.stringify({
      reverses_trans_no: input.original_trans_no,
      reverses_trans_type: input.original_trans_type,
    });
    let runningLedgerTotal = ledgerTotal;

    const inserted = await tx
      .insert(credits)
      .values(
        input.allocations.map((allocation, index) => {
          runningLedgerTotal += allocation.credits;

          return {
            trans_no: partTransNos[index]!,
            created_at: input.created_at,
            expired_at: allocation.expiredAt,
            org_uuid: input.org_uuid,
            user_uuid: input.user_uuid,
            trans_type: input.trans_type,
            credits: allocation.credits,
            order_no: allocation.orderNo,
            actor: input.actor,
            metadata_json: metadataForFefoPart({
              metadataJson: baseMetadata,
              rootTransNo: input.root_trans_no,
              partTransNos,
              partIndex: index,
              sourceTransNos: allocation.sourceTransNos,
            }),
            balance_after: runningLedgerTotal,
          };
        }),
      )
      .returning();

    const root = inserted.find(
      (credit) => credit.trans_no === input.root_trans_no,
    );
    if (!root || inserted.length !== input.allocations.length) {
      throw new AppError("CREDITS_GRANT_FAILED", {
        message: `refund insert returned an incomplete FEFO group for ${input.original_trans_no}`,
      });
    }

    return root;
  });
}

/** Lookup by `order_no`, also globally unique. Same caveat as above. */
export async function findCreditByOrderNo(
  order_no: string,
): Promise<typeof credits.$inferSelect | undefined> {
  const [credit] = await db()
    .select()
    .from(credits)
    .where(eq(credits.order_no, order_no))
    .limit(1);

  return credit;
}

/**
 * Every ledger row for an organization, newest first, unpaginated.
 *
 * Balance is the sum of the whole ledger, so anything computing it must see all
 * rows — `getCreditsByOrg` caps at 50 and would silently under-report for an
 * active account.
 */
export async function listAllCreditsByOrg(
  orgUuid: string,
): Promise<CreditRow[]> {
  return db()
    .select()
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, orgUuid))
    .orderBy(desc(credits.created_at), desc(credits.id));
}

/**
 * One read for both the ledger UI and its spendable balance.
 *
 * Returning the rows and derived snapshot together prevents a caller from
 * calculating the balance against a different instant or a different page of
 * the ledger.
 */
export async function getOrgCreditLedgerSnapshot(
  orgUuid: string,
  asOf: Date = new Date(),
): Promise<CreditLedgerSnapshot> {
  const rows = await listAllCreditsByOrg(orgUuid);
  return {
    rows,
    logicalRows: collapseCreditRowsToLogical(rows),
    balance: calculateCreditBalance(rows, asOf),
  };
}

/** Paginated view for the ledger UI. Do not use for balance arithmetic. */
export async function getCreditsByOrg(
  orgUuid: string,
  page: number = 1,
  limit: number = 50,
): Promise<(typeof credits.$inferSelect)[] | undefined> {
  return db()
    .select()
    .from(credits)
    .where(scopedToOrg(credits.org_uuid, orgUuid))
    .orderBy(desc(credits.created_at))
    .limit(limit)
    .offset((page - 1) * limit);
}
