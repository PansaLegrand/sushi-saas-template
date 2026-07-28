/**
 * `extractWebhookReceipt` maps a Stripe event onto the columns
 * `stripe_webhook_events` indexes.
 *
 * Worth its own unit tier because the whole function is assumptions about
 * Stripe's object shapes, and every one of them fails *silently*: a wrong read
 * writes a null, the webhook still succeeds, and the gap only surfaces when
 * someone runs the reconciliation query during an incident and it comes back
 * empty. Nothing throws, so nothing else would catch it.
 *
 * Fixtures are hand-written rather than captured, and deliberately partial —
 * they carry the fields the extractor reads and nothing else, so a test failing
 * points at one field.
 */
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { extractWebhookReceipt } from "@/services/stripe/receipt";

function event(overrides: Record<string, unknown>): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    api_version: "2025-01-01",
    livemode: true,
    created: 1767225600,
    request: null,
    ...overrides,
  } as unknown as Stripe.Event;
}

describe("extractWebhookReceipt", () => {
  it("pulls customer, subscription, and invoice off a checkout session", () => {
    const receipt = extractWebhookReceipt(
      event({
        type: "checkout.session.completed",
        data: {
          object: {
            object: "checkout.session",
            id: "cs_1",
            customer: "cus_1",
            subscription: "sub_1",
            invoice: "in_1",
          },
        },
      })
    );

    expect(receipt).toMatchObject({
      stripe_object_id: "cs_1",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      stripe_invoice_id: "in_1",
    });
  });

  it("uses the object's own id as the invoice id on an invoice event", () => {
    // The trap: an invoice carries no `invoice` field, so reading only the
    // reference would leave `stripe_invoice_id` null on exactly the events
    // reconciliation walks.
    const receipt = extractWebhookReceipt(
      event({
        type: "invoice.payment_succeeded",
        data: {
          object: {
            object: "invoice",
            id: "in_2",
            customer: "cus_2",
            subscription: "sub_2",
          },
        },
      })
    );

    expect(receipt.stripe_invoice_id).toBe("in_2");
    expect(receipt.stripe_object_id).toBe("in_2");
    expect(receipt.stripe_subscription_id).toBe("sub_2");
  });

  it("uses the object's own id as the subscription id on a subscription event", () => {
    const receipt = extractWebhookReceipt(
      event({
        type: "customer.subscription.updated",
        data: {
          object: {
            object: "subscription",
            id: "sub_3",
            customer: "cus_3",
          },
        },
      })
    );

    expect(receipt.stripe_subscription_id).toBe("sub_3");
    expect(receipt.stripe_object_id).toBe("sub_3");
    expect(receipt.stripe_invoice_id).toBeNull();
  });

  it("resolves an expanded object to its id, not to null", () => {
    // Stripe expandable fields are `string | Object`. A handler that expands
    // `customer` would otherwise silently write a null for the id.
    const receipt = extractWebhookReceipt(
      event({
        data: {
          object: {
            object: "checkout.session",
            id: "cs_4",
            customer: { id: "cus_4", object: "customer", email: "a@b.test" },
            subscription: { id: "sub_4", object: "subscription" },
          },
        },
      })
    );

    expect(receipt.stripe_customer_id).toBe("cus_4");
    expect(receipt.stripe_subscription_id).toBe("sub_4");
  });

  it("leaves absent ids null rather than empty strings", () => {
    // A dispute has no customer and no invoice. Null and "" both read as absent
    // in TypeScript but not in SQL: `where stripe_invoice_id is null` would miss
    // an empty string, so the distinction has to hold at the write.
    const receipt = extractWebhookReceipt(
      event({
        type: "charge.dispute.created",
        data: {
          object: { object: "dispute", id: "dp_1", charge: "ch_1" },
        },
      })
    );

    expect(receipt.stripe_object_id).toBe("dp_1");
    expect(receipt.stripe_customer_id).toBeNull();
    expect(receipt.stripe_invoice_id).toBeNull();
    expect(receipt.stripe_subscription_id).toBeNull();
  });

  it("treats an empty-string id as absent", () => {
    const receipt = extractWebhookReceipt(
      event({
        data: { object: { object: "checkout.session", id: "cs_5", customer: "" } },
      })
    );

    expect(receipt.stripe_customer_id).toBeNull();
  });

  it("records livemode false rather than confusing it with unknown", () => {
    // `false` and `null` mean different things: a test-mode event, versus a row
    // written before this column existed. `livemode || null` would conflate them.
    const receipt = extractWebhookReceipt(
      event({
        livemode: false,
        data: { object: { object: "checkout.session", id: "cs_6" } },
      })
    );

    expect(receipt.livemode).toBe(false);
  });

  it("records the request id when a dashboard action caused the event", () => {
    const receipt = extractWebhookReceipt(
      event({
        request: { id: "req_1", idempotency_key: null },
        data: { object: { object: "charge", id: "ch_2", invoice: "in_3" } },
      })
    );

    expect(receipt.request_id).toBe("req_1");
    expect(receipt.stripe_invoice_id).toBe("in_3");
  });

  it("leaves the request id null for an event Stripe raised itself", () => {
    const receipt = extractWebhookReceipt(
      event({
        request: null,
        data: { object: { object: "invoice", id: "in_4" } },
      })
    );

    expect(receipt.request_id).toBeNull();
  });

  it("returns all nulls for an event shape it does not recognize", () => {
    // The fallback has to be nulls, not a throw. An unrecognized shape must not
    // fail the webhook: losing the receipt costs a query later, while throwing
    // would make Stripe retry a delivery that was otherwise handled fine.
    const receipt = extractWebhookReceipt(
      event({ type: "some.future.event", data: { object: {} } })
    );

    expect(receipt.stripe_object_id).toBeNull();
    expect(receipt.stripe_customer_id).toBeNull();
    // Event-level fields are still recorded — they do not depend on the shape.
    expect(receipt.livemode).toBe(true);
    expect(receipt.api_version).toBe("2025-01-01");
  });
});
