import type Stripe from "stripe";

import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger/server";
import { notifySlackError } from "@/integrations/slack";
import {
  SubscriptionStatus,
  endSubscription,
  insertManualSubscription,
  listSubscriptionsByOrg,
  upsertStripeSubscription,
  type SubscriptionRow,
} from "@/models/subscription";
import {
  findOrganizationByStripeCustomerId,
  findPersonalOrganizationByUserUuid,
  type OrgUuid,
} from "@/models/organization";
import { findUserByStripeCustomerId, getUserUuidsByEmail } from "@/models/user";
import { isTier, tierForPriceIds } from "@/services/entitlements";
import type { Tier } from "@/types/plan";

/**
 * Keeping our record of what a user is entitled to in step with Stripe's.
 *
 * The rule this module follows, and the reason it is short: **Stripe's
 * subscription object is the truth, and we copy it wholesale.** We never
 * compute a state transition ourselves — no "if it was active and the invoice
 * failed then it is now past_due". Stripe already decided that, it sends the
 * decision on every `customer.subscription.*` event, and a second
 * implementation of the same state machine would eventually disagree with the
 * first about someone's access.
 *
 * Out-of-order delivery is handled one layer down, in
 * `upsertStripeSubscription`, by comparing event timestamps.
 */

export type SyncOutcome =
  | { status: "applied"; row: SubscriptionRow; tier: Tier }
  | { status: "stale" }
  | { status: "unmapped"; reason: "no-user" | "no-tier" | "no-org" };

/**
 * Write a Stripe subscription into our table.
 *
 * `eventAt` is the moment Stripe emitted the event, not the moment we received
 * it — receipt order means nothing after a retry.
 */
export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  eventAt: Date
): Promise<SyncOutcome> {
  const log = logger.child({ event: "subscription.sync", stripe_subscription_id: subscription.id });

  const userUuid = await resolveUserUuid(subscription);
  if (!userUuid) {
    // Loud on purpose. A subscription we cannot attribute is a paying customer
    // with no access, and it will not fix itself.
    log.error({ status: "unmapped", reason: "no-user" });
    notifySlackError("Subscription webhook: no user for subscription", undefined, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerIdOf(subscription),
    });
    return { status: "unmapped", reason: "no-user" };
  }

  const priceIds = subscription.items?.data?.map((item) => item.price?.id) ?? [];
  const tier = tierForPriceIds(priceIds);
  if (!tier) {
    // The subscription is real but its price is not in the catalog — someone
    // created a price in the Stripe dashboard and did not add it to
    // `src/config/plans.ts`. Granting a guessed tier would be worse than
    // saying so.
    log.error({ status: "unmapped", reason: "no-tier", price_ids: priceIds, user_id: userUuid });
    notifySlackError("Subscription webhook: price is not in the plan catalog", undefined, {
      stripe_subscription_id: subscription.id,
      price_ids: priceIds.join(","),
    });
    return { status: "unmapped", reason: "no-tier" };
  }

  const orgUuid = await resolveOrgUuid(subscription, userUuid);
  if (!orgUuid) {
    // Same reasoning as an unattributable user: entitlements resolve per org,
    // so a subscription with no org is a paying customer with no access.
    log.error({ status: "unmapped", reason: "no-org", user_id: userUuid });
    notifySlackError("Subscription webhook: no organization for subscription", undefined, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerIdOf(subscription),
    });
    return { status: "unmapped", reason: "no-org" };
  }

  const period = periodOf(subscription);

  const { applied, row } = await upsertStripeSubscription({
    uuid: newId(),
    org_uuid: orgUuid,
    user_uuid: userUuid,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerIdOf(subscription),
    stripe_price_id: priceIds.find(Boolean) ?? null,
    tier,
    status: subscription.status,
    current_period_start: period.start,
    current_period_end: period.end,
    trial_end: fromUnix(subscription.trial_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    ended_at: fromUnix(subscription.ended_at),
    stripe_event_at: eventAt,
  });

  if (!applied || !row) {
    // Not a failure: the row already holds a newer event than this one.
    log.info({ status: "stale", user_id: userUuid });
    return { status: "stale" };
  }

  log.info({
    status: "applied",
    user_id: userUuid,
    tier,
    subscription_status: subscription.status,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });

  return { status: "applied", row, tier };
}

/**
 * Who does this subscription belong to?
 *
 * Three sources, in descending order of trustworthiness:
 *
 *   1. `metadata.user_uuid`, which our own checkout sets.
 *   2. The Stripe customer id, stored on the user since their first checkout.
 *   3. The customer's email — last, because an email can be shared across
 *      sign-in providers, so it identifies an account only when exactly one
 *      matches.
 *
 * Step 2 and 3 exist for subscriptions created outside our checkout: a manual
 * upgrade from the Stripe dashboard, or a support fix.
 */
async function resolveUserUuid(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.user_uuid;
  if (fromMetadata) return fromMetadata;

  const customerId = customerIdOf(subscription);
  if (customerId) {
    const user = await findUserByStripeCustomerId(customerId);
    if (user) return user.uuid;
  }

  const email = emailOf(subscription);
  if (email) {
    const uuids = await getUserUuidsByEmail(email);
    // Exactly one, or we would be guessing which account to upgrade.
    if (uuids?.length === 1) return uuids[0];
  }

  return null;
}

/**
 * Which tenant a Stripe subscription belongs to.
 *
 * Ordered most to least authoritative. Checkout stamps `org_uuid` into
 * metadata, so that wins; the customer linkage is next; a personal org derived
 * from the resolved user is the last resort, and is correct for every account
 * that has never created a second organization.
 */
async function resolveOrgUuid(
  subscription: Stripe.Subscription,
  userUuid: string
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.org_uuid;
  if (fromMetadata) return fromMetadata;

  const customerId = customerIdOf(subscription);
  if (customerId) {
    const org = await findOrganizationByStripeCustomerId(customerId);
    if (org) return org.uuid;
  }

  const personal = await findPersonalOrganizationByUserUuid(userUuid);
  return personal?.uuid ?? null;
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function emailOf(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  if (!customer || typeof customer === "string") return null;
  if ("deleted" in customer && customer.deleted) return null;
  return customer.email ?? null;
}

/**
 * The current billing period.
 *
 * Stripe has been moving these fields from the subscription onto its items,
 * and which one is populated depends on the API version the account is pinned
 * to. Reading the subscription first and falling back to the first item covers
 * both without pinning this kit to one version.
 */
function periodOf(subscription: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;

  const raw = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };

  return {
    start: fromUnix(raw.current_period_start ?? item?.current_period_start),
    end: fromUnix(raw.current_period_end ?? item?.current_period_end),
  };
}

function fromUnix(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

// ------------------------------------------------------------ comped plans

export type CompResult =
  | { status: "granted"; row: SubscriptionRow }
  | { status: "invalid-tier" };

/**
 * Put a user on a tier without Stripe.
 *
 * Every product eventually needs this — a design partner, an apology, a
 * teammate's own account — and every product that did not plan for it ends up
 * with someone editing rows by hand in production. A comp is a normal
 * subscription row with `source = "manual"`, so it flows through exactly the
 * same resolution as a paid one and needs no special case anywhere else.
 *
 * `expiresAt` of null means indefinite. Callers in the admin app are expected
 * to write an audit log entry alongside this.
 */
export async function grantManualSubscription(input: {
  orgUuid: OrgUuid;
  userUuid: string;
  tier: string;
  expiresAt?: Date | null;
  note?: string;
}): Promise<CompResult> {
  if (!isTier(input.tier)) return { status: "invalid-tier" };

  const row = await insertManualSubscription({
    uuid: newId(),
    org_uuid: input.orgUuid,
    user_uuid: input.userUuid,
    tier: input.tier,
    status: SubscriptionStatus.Active,
    current_period_end: input.expiresAt ?? null,
    note: input.note ?? null,
  });

  if (!row) throw new Error("failed to insert manual subscription");

  logger.info({
    event: "subscription.comp.granted",
    user_id: input.userUuid,
    tier: input.tier,
    expires_at: input.expiresAt?.toISOString() ?? null,
  });

  return { status: "granted", row };
}

/** Revoke every comped subscription a user holds. Paid rows are untouched. */
export async function revokeManualSubscriptions(orgUuid: OrgUuid): Promise<number> {
  const rows = await listSubscriptionsByOrg(orgUuid, {
    statuses: [SubscriptionStatus.Active, SubscriptionStatus.Trialing],
  });

  const comped = rows.filter((row) => row.source === "manual");
  for (const row of comped) {
    await endSubscription(row.uuid);
  }

  if (comped.length > 0) {
    logger.info({
      event: "subscription.comp.revoked",
      org_id: orgUuid,
      count: comped.length,
    });
  }

  return comped.length;
}
