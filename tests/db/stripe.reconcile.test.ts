/**
 * Database tier: the reconciliation checks and the cron sweep.
 *
 * These are the audits for every guarantee the billing code makes, so they have
 * to run against the real thing. Two of the three checks are window functions and
 * outer joins over real rows — a mocked model would assert that the *query we
 * wrote* is the query we wrote.
 *
 * The findings here are all silent failures in production: nothing throws, no
 * constraint is violated, and each one is indistinguishable from correct
 * behaviour until a customer asks where their credits went. That is precisely why
 * the tests seed the broken state directly rather than trying to provoke it.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import {
  credits as creditsTable,
  jobs as jobsTable,
  orders as ordersTable,
  stripeWebhookEvents,
  users,
} from "@/db/schema";
import { OrderStatus } from "@/models/order";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventActionRequired,
  markStripeWebhookEventCompleted,
} from "@/models/stripe-webhook-event";
import { CreditsTransType, increaseCredits } from "@/services/credit";
import { ensurePersonalOrganization } from "@/services/organizations";
import {
  reconcileLocalBilling,
  reconcileStripeInvoices,
} from "@/services/stripe/reconcile";
import { sweepStripeWebhookEvents } from "@/services/stripe/sweep";

let USER = "";
let ORG = "";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUserWithOrg() {
  const id = randomUUID();
  const uuid = randomUUID();
  const email = `recon-${uuid}@test.dev`;

  await db()
    .insert(users)
    .values({ id, uuid, email, signin_provider: "credential" });
  const org = await ensurePersonalOrganization({ id, email });

  return { user: uuid, org: org.uuid };
}

async function seedPaidOrder(input: {
  orderNo: string;
  credits: number;
  subId?: string;
  periodStart?: number;
  paidAt?: Date;
}) {
  await db()
    .insert(ordersTable)
    .values({
      order_no: input.orderNo,
      created_at: input.paidAt ?? new Date(),
      org_uuid: ORG,
      user_uuid: USER,
      user_email: "buyer@test.dev",
      amount: 2900,
      status: OrderStatus.Paid,
      credits: input.credits,
      currency: "usd",
      sub_id: input.subId,
      sub_period_start: input.periodStart,
      paid_at: input.paidAt ?? new Date(),
    });
}

function eventFor(invoiceId: string, id = `evt_${invoiceId}`) {
  return {
    eventId: id,
    eventType: "invoice.payment_succeeded",
    payload: "{}",
    receipt: { stripe_invoice_id: invoiceId, livemode: true },
  };
}

/** Backdate a row's `updated_at`, since the stuck check keys on age. */
async function ageEvent(eventId: string, ms: number) {
  await db()
    .update(stripeWebhookEvents)
    .set({ updated_at: new Date(Date.now() - ms) })
    .where(eq(stripeWebhookEvents.event_id, eventId));
}

// Once for the file, not once per `describeDb`. Its `afterAll` closes the pool,
// so calling it inside the first block would shut the connection before the
// second block's tests ran. Same shape as tests/db/org-isolation.test.ts.
useCleanDatabase();

describeDb("stripe reconciliation (real database)", () => {
  beforeEach(async () => {
    const seeded = await seedUserWithOrg();
    USER = seeded.user;
    ORG = seeded.org;
  });

  it("reports no drift on a clean database", async () => {
    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("finds a paid order that promised credits and has none", async () => {
    // The exact state item 4's bug produced. Nothing threw when it happened, and
    // nothing throws now — the only way to know is to ask.
    await seedPaidOrder({ orderNo: "order_no_credits", credits: 100 });

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "order_missing_credits",
      severity: "error",
      detail: { order_no: "order_no_credits", credits_promised: 100 },
    });
  });

  it("accepts a paid order whose credits were granted", async () => {
    await seedPaidOrder({ orderNo: "order_ok", credits: 100 });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: "order_ok",
      actor: "stripe:webhook",
    });

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.findings).toEqual([]);
  });

  it("ignores a paid order that never promised credits", async () => {
    // A zero-credit plan is legitimate, so it must not be reported as missing a
    // grant that was never owed.
    await seedPaidOrder({ orderNo: "order_zero", credits: 0 });

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.findings).toEqual([]);
  });

  it("ignores an order paid before the window", async () => {
    await seedPaidOrder({
      orderNo: "order_old",
      credits: 100,
      paidAt: new Date(Date.now() - 30 * DAY_MS),
    });

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.findings).toEqual([]);
  });

  it("detects a running balance that disagrees with the ledger", async () => {
    // What two concurrent writes against one stale read would leave behind. It
    // cannot be provoked through the service any more — the org lock prevents it
    // — so the corrupt value is written directly, which is also how a bad manual
    // SQL fix would arrive.
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });
    await db()
      .update(creditsTable)
      .set({ balance_after: 10 })
      .where(eq(creditsTable.credits, 10));

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    const drift = report.findings.filter((f) => f.kind === "ledger_balance_drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      severity: "error",
      detail: { balance_after: 10, expected_balance_after: 20 },
    });
    expect(report.ok).toBe(false);
  });

  it("does not report pre-0018 rows with no running balance as drift", async () => {
    // A null means "written before the column existed", which is a fact rather
    // than a defect. Reporting it would make the check useless on any database
    // with history.
    await db()
      .insert(creditsTable)
      .values({
        trans_no: "legacy",
        created_at: new Date(),
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.SystemAdd,
        credits: 40,
        order_no: "",
      });

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.findings.filter((f) => f.kind === "ledger_balance_drift")).toEqual(
      []
    );
  });

  it("counts history toward the first tracked row's running balance", async () => {
    // The subtle half of the rule above: `lockOrgAndSumLedger` sums every row, so
    // the first post-0018 grant legitimately carries a total that includes the
    // untracked history. A check that restarted from zero would flag it.
    await db()
      .insert(creditsTable)
      .values({
        trans_no: "legacy-2",
        created_at: new Date(),
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.SystemAdd,
        credits: 40,
        order_no: "",
      });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });

    const rows = await db()
      .select()
      .from(creditsTable)
      .where(eq(creditsTable.trans_type, CreditsTransType.SystemAdd));
    expect(rows.find((r) => r.trans_no !== "legacy-2")?.balance_after).toBe(50);

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });
    expect(report.findings.filter((f) => f.kind === "ledger_balance_drift")).toEqual(
      []
    );
  });

  it("reports a parked event as a warning, not a release blocker", async () => {
    // An unmapped price must not block every deploy until someone maps it. A
    // check that gates a pipeline on a human's queue is a check that gets
    // switched off.
    await claimStripeWebhookEvent(eventFor("in_parked"));
    await markStripeWebhookEventActionRequired(
      "evt_in_parked",
      "unmapped_price (stripe_price_id=price_x)"
    );

    const report = await reconcileLocalBilling({ since: new Date(Date.now() - DAY_MS) });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "stuck_event",
      severity: "warn",
    });
    // Warnings do not fail the run.
    expect(report.ok).toBe(true);
    expect(report.eventsByStatus).toMatchObject({ action_required: 1 });
  });

  it("flags a paid Stripe invoice this deployment never recorded", async () => {
    // Only the Stripe half can catch this: money was taken and no event for it
    // exists locally, so there is nothing in the database to notice.
    const report = await reconcileStripeInvoices({
      since: new Date(Date.now() - DAY_MS),
      invoices: [
        { id: "in_unknown", subscription: "sub_1", period_start: 1767225600 },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      kind: "invoice_without_receipt",
      severity: "error",
      detail: { stripe_invoice_id: "in_unknown" },
    });
  });

  it("flags an invoice whose event arrived but whose order is missing", async () => {
    await claimStripeWebhookEvent(eventFor("in_no_order"));
    await markStripeWebhookEventCompleted("evt_in_no_order");

    const report = await reconcileStripeInvoices({
      since: new Date(Date.now() - DAY_MS),
      invoices: [
        { id: "in_no_order", subscription: "sub_9", period_start: 1767225600 },
      ],
    });

    expect(report.findings[0]).toMatchObject({
      kind: "invoice_without_order",
      // The event says completed, so nothing explains the missing order.
      severity: "error",
    });
    expect(report.ok).toBe(false);
  });

  it("downgrades a missing order that a parked event already explains", async () => {
    // Otherwise the same problem is counted twice, once at a severity that fails
    // the run — and the fix for the second copy is the fix for the first.
    await claimStripeWebhookEvent(eventFor("in_parked_order"));
    await markStripeWebhookEventActionRequired(
      "evt_in_parked_order",
      "unmapped_price"
    );

    const report = await reconcileStripeInvoices({
      since: new Date(Date.now() - DAY_MS),
      invoices: [
        { id: "in_parked_order", subscription: "sub_8", period_start: 1767225600 },
      ],
    });

    const missing = report.findings.find((f) => f.kind === "invoice_without_order");
    expect(missing).toMatchObject({
      severity: "warn",
      detail: { explained_by_stuck_event: true },
    });
    expect(report.ok).toBe(true);
  });

  it("accepts an invoice with both an event and its order", async () => {
    await claimStripeWebhookEvent(eventFor("in_full"));
    await markStripeWebhookEventCompleted("evt_in_full");
    await seedPaidOrder({
      orderNo: "order_full",
      credits: 100,
      subId: "sub_7",
      periodStart: 1767225600,
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: "order_full",
      actor: "stripe:webhook",
    });

    const report = await reconcileStripeInvoices({
      since: new Date(Date.now() - DAY_MS),
      invoices: [{ id: "in_full", subscription: "sub_7", period_start: 1767225600 }],
    });

    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkedInvoices).toBe(1);
  });

  it("ignores a one-off invoice with no subscription", async () => {
    // No subscription means no deterministic renewal order to look for. Not a
    // defect, so it must not be reported as one.
    await claimStripeWebhookEvent(eventFor("in_oneoff"));
    await markStripeWebhookEventCompleted("evt_in_oneoff");

    const report = await reconcileStripeInvoices({
      since: new Date(Date.now() - DAY_MS),
      invoices: [{ id: "in_oneoff", subscription: null, period_start: null }],
    });

    expect(report.findings).toEqual([]);
  });
});

describeDb("stripe webhook sweep (real database)", () => {
  it("finds nothing and alerts nobody on a clean table", async () => {
    const result = await sweepStripeWebhookEvents();

    expect(result.stuck).toBe(0);
    expect(result.alerted).toBe(false);
    expect(await db().select().from(jobsTable)).toHaveLength(0);
  });

  it("alerts on a parked event and says what it is", async () => {
    await claimStripeWebhookEvent(eventFor("in_sweep"));
    await markStripeWebhookEventActionRequired("evt_in_sweep", "unmapped_price");

    const result = await sweepStripeWebhookEvents();

    expect(result).toMatchObject({
      stuck: 1,
      actionRequired: 1,
      failedPastRetries: 0,
      alerted: true,
    });

    const [job] = await db().select().from(jobsTable);
    expect(job?.type).toBe("slack_error");
    expect(job?.payload_json).toContain("unmapped_price");
  });

  it("leaves a recent failure to Stripe's own retries", async () => {
    // Under four days a failure is probably transient, and alerting on it means
    // alerting on every blip. Stripe is still redelivering it.
    await claimStripeWebhookEvent(eventFor("in_recent_fail"));
    await db()
      .update(stripeWebhookEvents)
      .set({ status: "failed" })
      .where(eq(stripeWebhookEvents.event_id, "evt_in_recent_fail"));

    const result = await sweepStripeWebhookEvents();

    expect(result.stuck).toBe(0);
    expect(result.alerted).toBe(false);
  });

  it("reports a failure Stripe has stopped retrying", async () => {
    // Past the retry window the row will stay `failed` forever with nothing left
    // to retry it, and it looks identical to one that would have succeeded. Age
    // is the only thing that tells them apart.
    await claimStripeWebhookEvent(eventFor("in_old_fail"));
    await db()
      .update(stripeWebhookEvents)
      .set({ status: "failed" })
      .where(eq(stripeWebhookEvents.event_id, "evt_in_old_fail"));
    await ageEvent("evt_in_old_fail", 5 * DAY_MS);

    const result = await sweepStripeWebhookEvents();

    expect(result).toMatchObject({
      stuck: 1,
      actionRequired: 0,
      failedPastRetries: 1,
      alerted: true,
    });
  });

  it("alerts once an hour rather than on every five-minute tick", async () => {
    // An unfixed problem should keep reminding you. It should not train you to
    // ignore the channel.
    await claimStripeWebhookEvent(eventFor("in_dedupe"));
    await markStripeWebhookEventActionRequired("evt_in_dedupe", "unmapped_price");

    const first = await sweepStripeWebhookEvents(new Date("2026-07-28T10:05:00Z"));
    const second = await sweepStripeWebhookEvents(new Date("2026-07-28T10:55:00Z"));
    const nextHour = await sweepStripeWebhookEvents(new Date("2026-07-28T11:05:00Z"));

    expect(first.alerted).toBe(true);
    // Same hour: the dedupe key collides, so no second alert.
    expect(second.alerted).toBe(false);
    expect(nextHour.alerted).toBe(true);

    // Still reported in the result every time, so the cron log never goes quiet.
    expect([first.stuck, second.stuck, nextHour.stuck]).toEqual([1, 1, 1]);
    expect(await db().select().from(jobsTable)).toHaveLength(2);
  });
});
