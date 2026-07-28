/**
 * Database tier: what a refund would cost to reverse.
 *
 * `assessRefund` computes the numbers a human is handed when money moves back
 * out. Its whole output is arithmetic over real ledger rows and a real order, so
 * a mocked model would only confirm the mock's arithmetic.
 *
 * The shortfall is the number the decision turns on: how much of the grant can no
 * longer be taken back because it has already been spent. Getting it wrong means
 * either quietly driving an org negative or refunding money and leaving the
 * credits — so it is computed at write time, and pinned here.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { orders as ordersTable, users } from "@/db/schema";
import { OrderStatus } from "@/models/order";
import {
  CreditsTransType,
  decreaseCredits,
  increaseCredits,
} from "@/services/credit";
import { ensurePersonalOrganization } from "@/services/organizations";
import { assessRefund } from "@/services/stripe/refund";

let USER = "";
let ORG = "";

const SUB = "sub_refund_1";
const PERIOD_START = 1767225600;
const INVOICE = "in_refund_1";

/**
 * A Stripe client stubbed to the two calls `assessRefund` makes. Written by hand
 * rather than mocked at the module level so each test can change one answer —
 * a missing invoice, a throwing lookup — and see the resolution change.
 */
function stubStripe(overrides: {
  charge?: Partial<Stripe.Charge> | Error;
  invoice?: Partial<Stripe.Invoice> | Error;
} = {}) {
  const resolve = <T>(value: T | Error | undefined, fallback: T) => {
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve({ ...fallback, ...(value ?? {}) });
  };

  return {
    charges: {
      retrieve: vi.fn(() =>
        resolve(overrides.charge, { id: "ch_1", invoice: INVOICE } as Stripe.Charge)
      ),
    },
    invoices: {
      retrieve: vi.fn(() =>
        resolve(overrides.invoice, {
          id: INVOICE,
          subscription: SUB,
          lines: { data: [{ period: { start: PERIOD_START, end: 0 } }] },
        } as unknown as Stripe.Invoice)
      ),
    },
  } as unknown as Stripe;
}

function refundedEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    livemode: true,
    data: {
      object: {
        object: "charge",
        id: "ch_1",
        invoice: INVOICE,
        amount: 2900,
        amount_refunded: 2900,
        currency: "usd",
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function disputeEvent(): Stripe.Event {
  return {
    id: "evt_dispute_1",
    type: "charge.dispute.created",
    livemode: true,
    data: {
      object: {
        object: "dispute",
        id: "dp_1",
        charge: "ch_1",
        amount: 2900,
        currency: "usd",
      },
    },
  } as unknown as Stripe.Event;
}

async function seedRenewalOrder(credits: number) {
  await db()
    .insert(ordersTable)
    .values({
      order_no: `renewal:${SUB}:${PERIOD_START}`,
      created_at: new Date(),
      org_uuid: ORG,
      user_uuid: USER,
      user_email: "buyer@test.dev",
      amount: 2900,
      status: OrderStatus.Paid,
      credits,
      currency: "usd",
      sub_id: SUB,
      sub_period_start: PERIOD_START,
      paid_at: new Date(),
    });

  return `renewal:${SUB}:${PERIOD_START}`;
}

useCleanDatabase();

describeDb("refund assessment (real database)", () => {
  beforeEach(async () => {
    const id = randomUUID();
    const uuid = randomUUID();
    const email = `refund-${uuid}@test.dev`;

    await db()
      .insert(users)
      .values({ id, uuid, email, signin_provider: "credential" });
    const org = await ensurePersonalOrganization({ id, email });

    USER = uuid;
    ORG = org.uuid;
  });

  it("reports no shortfall when the credits are all still there", async () => {
    const orderNo = await seedRenewalOrder(100);
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: orderNo,
      actor: "stripe:webhook",
    });

    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment).toMatchObject({
      kind: "refund",
      resolution: "resolved",
      order_no: orderNo,
      granted_credits: 100,
      current_balance: 100,
      shortfall: 0,
      amount_refunded: 2900,
    });
  });

  it("computes the shortfall when some credits are already spent", async () => {
    // The case that rules out reversing automatically: 40 of the 100 are gone, so
    // there is no silent answer — take 60 and under-reverse, or take 100 and drive
    // the balance negative. Someone has to choose.
    const orderNo = await seedRenewalOrder(100);
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: orderNo,
      actor: "stripe:webhook",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 40,
      actor: `user:${USER}`,
    });

    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment).toMatchObject({
      resolution: "resolved",
      granted_credits: 100,
      current_balance: 60,
      shortfall: 40,
    });
  });

  it("reports the whole grant as the shortfall when nothing is left", async () => {
    const orderNo = await seedRenewalOrder(100);
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: orderNo,
      actor: "stripe:webhook",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 100,
      actor: `user:${USER}`,
    });

    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment).toMatchObject({ current_balance: 0, shortfall: 100 });
  });

  it("never reports a negative shortfall when the balance has grown", async () => {
    // A later grant can leave more credits than this refund ever paid for. The
    // shortfall is what cannot be recovered, so it floors at zero rather than
    // implying the org owes credits back.
    const orderNo = await seedRenewalOrder(100);
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: orderNo,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 500,
      actor: "admin:admin-1",
    });

    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment.current_balance).toBe(600);
    expect(assessment.shortfall).toBe(0);
  });

  it("says the grant is unresolved when the order carried no ledger row", async () => {
    // Distinct from "no order": the order exists and was never credited, which is
    // item 4's bug shape. There is nothing to reverse, and saying so is different
    // from failing to look.
    await seedRenewalOrder(100);

    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment.resolution).toBe("grant_unresolved");
    expect(assessment.order_no).toBe(`renewal:${SUB}:${PERIOD_START}`);
    expect(assessment.shortfall).toBeUndefined();
  });

  it("says the order is unresolved when no local order matches", async () => {
    const assessment = await assessRefund(stubStripe(), refundedEvent());

    expect(assessment.resolution).toBe("order_unresolved");
    expect(assessment.stripe_invoice_id).toBe(INVOICE);
    // Still carries what it does know, because a parked row with partial detail
    // beats one with none.
    expect(assessment.amount_refunded).toBe(2900);
    expect(assessment.charge_id).toBe("ch_1");
  });

  it("resolves a dispute through the charge it references", async () => {
    // A dispute carries a charge reference rather than an invoice, so it needs one
    // extra lookup that a refund does not.
    const orderNo = await seedRenewalOrder(100);
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: orderNo,
      actor: "stripe:webhook",
    });

    const stripe = stubStripe();
    const assessment = await assessRefund(stripe, disputeEvent());

    expect(assessment.kind).toBe("dispute");
    expect(assessment.resolution).toBe("resolved");
    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1");
  });

  it("still assesses what it can when Stripe is unreachable", async () => {
    // A Stripe blip must not stop the event being parked. An unparked refund is
    // invisible; a parked one with a missing order number is merely incomplete.
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const assessment = await assessRefund(
      stubStripe({ invoice: new Error("stripe down") }),
      refundedEvent()
    );

    expect(assessment.resolution).toBe("order_unresolved");
    expect(assessment.charge_id).toBe("ch_1");
    expect(assessment.amount_refunded).toBe(2900);
    consoleWarn.mockRestore();
  });

  it("handles a charge with no invoice behind it", async () => {
    // A one-off checkout charge has no invoice, so there is no path to an order
    // yet. Recorded honestly as unresolved rather than guessed at — see the
    // roadmap note on `stripe_payment_intent_id`.
    const assessment = await assessRefund(
      stubStripe(),
      refundedEvent({ invoice: null })
    );

    expect(assessment.resolution).toBe("order_unresolved");
    expect(assessment.stripe_invoice_id).toBeUndefined();
  });
});
