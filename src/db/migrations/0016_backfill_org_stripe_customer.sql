-- Backfill: move each user's Stripe customer onto their personal organization.
--
-- Billing moved from the person to the tenant. Without this, an existing
-- paying customer's org has no `stripe_customer_id`, so the next portal visit
-- or checkout would mint a *second* Stripe customer for them — leaving their
-- card, invoices, and subscription behind on the first one while the app bills
-- the second. Silent, and expensive to unpick after the fact.
--
-- `users.stripe_customer_id` is deliberately left in place. Subscription
-- webhooks for anything created before this still resolve through it, and
-- keeping it costs nothing.
--
-- Idempotent: guarded on the target being null, so a re-run never reassigns a
-- customer that has since been set.
--
-- Only personal organizations are touched. A shared team has no pre-existing
-- customer to inherit — it did not exist before tenancy did — and guessing one
-- from a member would attach that person's card to the team.

UPDATE organizations o
SET stripe_customer_id = u.stripe_customer_id,
    updated_at = now()
FROM org_members m
JOIN users u ON u.id = m.user_id
WHERE m.organization_id = o.id
  AND o.is_personal = true
  AND o.stripe_customer_id IS NULL
  AND u.stripe_customer_id IS NOT NULL
  AND u.stripe_customer_id <> '';
