import Stripe from "stripe";
import { newStripeClient } from "@/integrations/stripe";
import { setOrganizationStripeCustomerId } from "@/models/organization";

/**
 * The Stripe customer belongs to the organization, not to the person.
 *
 * This is how every team product bills, and the reason is not tidiness. With a
 * per-user customer the subscription lives on the org but the payment method
 * lives on whoever happened to click checkout — so when that person leaves, their
 * card keeps paying for a team they are no longer in, and nobody remaining can
 * see or change it. Attaching the customer to the tenant makes handing over
 * billing a membership change rather than a billing migration.
 *
 * `users.stripe_customer_id` is still *read* when attributing subscriptions
 * created before this change. It is no longer written.
 */

type OrgBillingSubject = {
  /** The organization's public uuid — what `organizations.stripe_customer_id` keys on. */
  orgUuid: string;
  orgName: string;
  /** Billing contact: the acting owner's address when the customer is created. */
  email: string;
  stripe_customer_id?: string | null;
};

export async function getOrCreateCustomerIdForOrg(
  org: OrgBillingSubject
): Promise<string> {
  if (org.stripe_customer_id && org.stripe_customer_id.length > 0) {
    return org.stripe_customer_id;
  }

  const client = newStripeClient();
  const stripe: Stripe = client.stripe();

  // Adopt a customer we created for this org but failed to record. A crash
  // between `customers.create` and the database write would otherwise strand
  // that customer and mint a fresh one on every retry.
  const list = await stripe.customers.list({ email: org.email, limit: 100 });
  const existing = list.data.find(
    (candidate) => candidate.metadata?.org_uuid === org.orgUuid
  );

  if (existing) {
    await setOrganizationStripeCustomerId(org.orgUuid, existing.id).catch(() => void 0);
    return existing.id;
  }

  // Deliberately *not* adopting a customer that merely shares the email, which
  // the per-user version did. Two organizations can be billed to the same
  // address — a consultant with several clients, or one person's personal and
  // team workspaces — and adopting on email alone would put both tenants'
  // subscriptions behind a single payment method.
  const created = await stripe.customers.create(
    {
      email: org.email,
      name: org.orgName,
      metadata: {
        org_uuid: org.orgUuid,
      },
    },
    {
      // The list/adopt check protects a later retry. This key protects two
      // checkouts that reach customer creation concurrently, before either one
      // has saved the new customer id on the organization.
      idempotencyKey: `org-customer:${org.orgUuid}`,
    }
  );

  await setOrganizationStripeCustomerId(org.orgUuid, created.id).catch(() => void 0);
  return created.id;
}
