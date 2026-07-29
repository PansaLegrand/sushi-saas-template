import type Stripe from "stripe";

/**
 * Flatten a Stripe event into the columns `stripe_webhook_events` indexes.
 *
 * The payload is already stored whole, as `text`. This exists because a `text`
 * column cannot answer "every event for this subscription" without a full scan
 * and a JSON parse per row — which is exactly the question you have during an
 * incident, when the table is at its largest and you are in a hurry.
 *
 * Deliberately in the service layer: the model stays a writer that takes values
 * and puts them in columns, and every assumption about Stripe's object shapes
 * lives here, in one file, with tests over it.
 */
export type StripeWebhookReceipt = {
  stripe_object_id: string | null;
  stripe_customer_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  livemode: boolean | null;
  api_version: string | null;
  request_id: string | null;
};

/**
 * Stripe expandable fields are `string | Object | null` — the id when
 * unexpanded, the whole object when expanded. Both must resolve to the id, or a
 * handler that happens to expand a field would silently write a null.
 */
function referencedId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

/**
 * The durable payment receipt saved on an order.
 *
 * Stripe objects contain addresses, email, names, card fingerprints, metadata,
 * and provider-internal fields that are not needed to prove fulfillment. Keep a
 * small allowlist instead: these identifiers are enough to reconcile the local
 * order against Stripe without turning `orders.paid_detail` into a second copy
 * of the customer's Stripe profile.
 */
export function extractCheckoutPaymentReceipt(
  session: Stripe.Checkout.Session,
) {
  const paymentIntent =
    session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent
      : null;
  return {
    schema_version: 1,
    checkout_session_id: session.id,
    payment_intent_id: referencedId(session.payment_intent),
    charge_id: referencedId(paymentIntent?.latest_charge),
    subscription_id: referencedId(session.subscription),
    invoice_id: referencedId(session.invoice),
    customer_id: referencedId(session.customer),
    payment_status: session.payment_status ?? null,
    checkout_status: session.status ?? null,
    amount_total:
      typeof session.amount_total === "number" ? session.amount_total : null,
    currency: session.currency ?? null,
  };
}

/**
 * Read from the object's own `object` discriminator rather than switching on
 * `event.type`.
 *
 * There are ~250 event types and a handful of object shapes, so the switch would
 * be long, and — the actual reason — it would be *silently* incomplete: a new
 * event type this app starts handling would extract nothing and log no
 * complaint. The discriminator covers every event carrying a shape we know.
 */
export function extractWebhookReceipt(
  event: Stripe.Event,
): StripeWebhookReceipt {
  // Through `unknown`, because `event.data.object` is a union of ~70 Stripe
  // types and the compiler is right that none of them is an index signature.
  // Every read below is guarded, so a shape without the field yields null rather
  // than throwing.
  const object = event.data?.object as unknown as
    | (Record<string, unknown> & { object?: string })
    | undefined;

  const kind = object?.object;
  const objectId = referencedId(object?.id);

  return {
    stripe_object_id: objectId,
    stripe_customer_id: referencedId(object?.customer),
    // When the event *is* about an invoice, the invoice id is the object's own.
    // Otherwise take the reference a charge or checkout session carries.
    //
    // Known limitation: on Stripe API versions after this SDK's pinned one, an
    // invoice's subscription moves out of `invoice.subscription`. This reads the
    // shape stripe@17 defines — the same field `src/app/api/pay/webhook/stripe`
    // already reads — so both would need updating together on that upgrade.
    stripe_invoice_id:
      kind === "invoice" ? objectId : referencedId(object?.invoice),
    stripe_subscription_id:
      kind === "subscription" ? objectId : referencedId(object?.subscription),
    // Recorded rather than trusted: the webhook rejects a non-live event in
    // production before it is ever claimed. This is the receipt for events that
    // legitimately are test-mode, in development.
    livemode: typeof event.livemode === "boolean" ? event.livemode : null,
    // Which API version rendered the payload. The stored JSON is only
    // interpretable against it, so a payload without one is a payload you have
    // to guess at.
    api_version: event.api_version || null,
    // The dashboard or API call that caused it. Null for events Stripe raised on
    // its own, such as a renewal — which is most of them.
    request_id: referencedId(event.request) ?? null,
  };
}
