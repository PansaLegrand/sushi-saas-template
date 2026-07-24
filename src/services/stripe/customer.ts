import Stripe from "stripe";
import { newStripeClient } from "@/integrations/stripe";
import { updateUserStripeCustomerId } from "@/models/user";

type MinimalUser = {
  uuid: string;
  email: string;
  nickname?: string | null;
  stripe_customer_id?: string | null;
};

export async function getOrCreateCustomerIdForUser(user: MinimalUser): Promise<string> {
  // Reuse stored ID if present
  if (user.stripe_customer_id && user.stripe_customer_id.length > 0) {
    return user.stripe_customer_id;
  }

  const client = newStripeClient();
  const stripe: Stripe = client.stripe();

  // Find existing customers by email; prefer one whose metadata.user_uuid matches
  const list = await stripe.customers.list({ email: user.email, limit: 100 });
  const withMatchingMeta = list.data.find((c) => (c.metadata?.user_uuid as any) === user.uuid);
  if (withMatchingMeta) {
    await updateUserStripeCustomerId(user.uuid, withMatchingMeta.id).catch(() => void 0);
    return withMatchingMeta.id;
  }

  // Adopt a customer with missing metadata by annotating it
  const withoutMeta = list.data.find((c) => !c.metadata || !("user_uuid" in c.metadata) || !c.metadata.user_uuid);
  if (withoutMeta) {
    try {
      await stripe.customers.update(withoutMeta.id, {
        metadata: { user_uuid: user.uuid },
      });
    } catch {
      // ignore update failure; still use the customer
    }
    await updateUserStripeCustomerId(user.uuid, withoutMeta.id).catch(() => void 0);
    return withoutMeta.id;
  }

  // Otherwise create a new dedicated Customer and attach user UUID in metadata
  const created = await stripe.customers.create({
    email: user.email,
    name: user.nickname || undefined,
    metadata: {
      user_uuid: user.uuid,
    },
  });
  await updateUserStripeCustomerId(user.uuid, created.id).catch(() => void 0);
  return created.id;
}
