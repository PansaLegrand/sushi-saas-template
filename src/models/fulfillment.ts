import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { credits, orders } from "@/db/schema";

import { type CreditActor, lockOrgAndSumLedger } from "./credit";
import { OrderStatus, type OrderInsert } from "./order";
import { scopedToOrg } from "./organization";

/**
 * Recording a payment and crediting it, committed together.
 *
 * Every function here writes two tables in one transaction, and the reason is
 * a bug this kit shipped with. Fulfillment used to be a sequence: mark the
 * order paid, then grant the credits, guarded by an early return when the
 * order was *already* paid. That guard asks the wrong question. It checks
 * whether the payment was recorded, then skips work that is not the payment —
 * so a crash between the two writes left a paid order with no credits, and the
 * next delivery made it permanent: Stripe redelivers, the handler sees `paid`,
 * returns, and the event is marked completed. No error, no retry left, no
 * trace except a customer who paid for nothing.
 *
 * Two properties are needed, and they are not the same property:
 *
 *   **Atomic** — the order status and the ledger row commit together, so the
 *   inconsistent state has no window to be observed in. That is this file.
 *
 *   **Idempotent** — a redelivery must not grant twice. A transaction does not
 *   give you this: two concurrent deliveries each open their own transaction
 *   and each insert a row. What gives you this is a deterministic `trans_no`
 *   under the unique index on `credits.trans_no`, built by
 *   `src/services/stripe/idempotency.ts` and enforced by the
 *   `onConflictDoNothing` below.
 *
 * Both, or neither is enough.
 *
 * Stripe API calls stay *outside* these functions on purpose. A transaction
 * holds a connection from a pool of ten; a transaction that waits on someone
 * else's network is how a webhook burst exhausts the pool.
 */

/** A ledger row to write alongside the payment. */
export type CreditGrant = {
  /**
   * Deterministic, derived from the Stripe object this grant pays for. This is
   * the idempotency key: `credits.trans_no` is unique, so a replay conflicts
   * instead of double-crediting.
   */
  trans_no: string;
  trans_type: string;
  credits: number;
  expired_at?: Date | null;
  /**
   * Who caused it. Required rather than defaulted to `stripe:webhook` even
   * though every caller today is a webhook: a default here is how a
   * hand-triggered backfill ends up indistinguishable from a real payment.
   */
  actor: CreditActor;
  metadata_json?: string | null;
};

export type OrderRow = typeof orders.$inferSelect;

export type PaidOrderResult = {
  order?: OrderRow;
  /** False when the ledger already held this grant — a replay, not a failure. */
  credit_granted: boolean;
};

export type RenewalOrderResult = PaidOrderResult & {
  /** False when this billing period had already been recorded. */
  order_created: boolean;
};

/**
 * Mark an existing order paid and credit its organization, atomically.
 *
 * Safe to call repeatedly for the same order: the status write is a no-op
 * second time, and the grant conflicts on `trans_no`. Callers therefore need no
 * "has this happened yet" check — which is the point, because that check is
 * what was wrong.
 */
export async function markOrderPaidWithGrant(input: {
  order_no: string;
  org_uuid: string;
  user_uuid: string;
  paid_at: Date;
  paid_email: string;
  paid_detail: string;
  grant?: CreditGrant | null;
}): Promise<PaidOrderResult> {
  return db().transaction(async (tx) => {
    const [order] = await tx
      .update(orders)
      .set({
        status: OrderStatus.Paid,
        paid_at: input.paid_at,
        paid_email: input.paid_email,
        paid_detail: input.paid_detail,
      })
      .where(
        and(
          eq(orders.order_no, input.order_no),
          scopedToOrg(orders.org_uuid, input.org_uuid)
        )
      )
      .returning();

    if (!order) {
      // The order does not exist, or belongs to another tenant. Either way this
      // payment cannot be attributed, and rolling back beats crediting a
      // balance we guessed at.
      return { order: undefined, credit_granted: false };
    }

    const credit_granted = await insertGrant(tx, {
      org_uuid: input.org_uuid,
      user_uuid: input.user_uuid,
      order_no: input.order_no,
      grant: input.grant,
    });

    return { order, credit_granted };
  });
}

/**
 * Record a subscription renewal and credit it, atomically.
 *
 * The order carries a deterministic `order_no` derived from the billing period,
 * so the insert conflicts on replay rather than opening a second order for a
 * cycle already billed. The grant is attempted whether or not the order was new
 * — that is the fix for the renewal half of the same bug, where an order
 * written without its credits could never be corrected.
 */
export async function insertRenewalOrderWithGrant(input: {
  /**
   * `user_uuid` is required here even though `orders` defaults it to `""`. The
   * ledger row written alongside carries it for per-member attribution, that
   * column is `not null` with no default, and it cannot be backfilled after the
   * fact — so the caller has to know who renewed.
   */
  order: OrderInsert & { user_uuid: string };
  grant?: CreditGrant | null;
}): Promise<RenewalOrderResult> {
  const { order: orderInput, grant } = input;

  return db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(orders)
      .values(orderInput)
      .onConflictDoNothing({ target: orders.order_no })
      .returning();

    const credit_granted = await insertGrant(tx, {
      org_uuid: orderInput.org_uuid,
      user_uuid: orderInput.user_uuid,
      order_no: orderInput.order_no,
      grant,
    });

    return {
      order: inserted,
      order_created: Boolean(inserted),
      credit_granted,
    };
  });
}

/**
 * The ledger half of both writes.
 *
 * `onConflictDoNothing` on `trans_no` is what makes a replay cost nothing. An
 * empty `returning()` means the row was already there, which is reported to the
 * caller rather than swallowed: "already granted" and "granted just now" are
 * different events to log, even though both are successes.
 */
async function insertGrant(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  input: {
    org_uuid: string;
    user_uuid: string;
    order_no: string;
    grant?: CreditGrant | null;
  }
): Promise<boolean> {
  const { grant } = input;
  if (!grant || grant.credits <= 0) return false;

  // The org lock, taken before the total is read so the row cannot land against
  // a stale one. On a replay the insert below conflicts and the computed
  // `balance_after` is discarded with the row it was for — which is why the lock
  // being wasted on a no-op is acceptable and a pre-check for the conflict is
  // still not.
  const ledgerTotal = await lockOrgAndSumLedger(tx, input.org_uuid);

  const [row] = await tx
    .insert(credits)
    .values({
      trans_no: grant.trans_no,
      created_at: new Date(),
      org_uuid: input.org_uuid,
      user_uuid: input.user_uuid,
      trans_type: grant.trans_type,
      credits: grant.credits,
      order_no: input.order_no,
      expired_at: grant.expired_at ?? null,
      actor: grant.actor,
      metadata_json: grant.metadata_json ?? null,
      balance_after: ledgerTotal + grant.credits,
    })
    .onConflictDoNothing({ target: credits.trans_no })
    .returning();

  return Boolean(row);
}
