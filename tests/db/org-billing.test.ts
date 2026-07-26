/**
 * Database tier: billing belongs to the organization.
 *
 * Two things are checked here and neither is visible in a type check. The
 * Stripe customer has to land on the org rather than the person, and migration
 * 0016 has to move existing customers across — because the failure mode if it
 * does not is that a paying customer silently acquires a *second* Stripe
 * customer, leaving their card, invoices, and subscription stranded on the
 * first while the app bills the second.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import {
  findOrganizationByStripeCustomerId,
  findOrganizationByUuid,
  setOrganizationStripeCustomerId,
} from "@/models/organization";
import { ensurePersonalOrganization } from "@/services/organizations";

useCleanDatabase();

let user: { id: string; uuid: string; email: string };
let orgUuid: string;

async function seedUser(customerId?: string) {
  const id = randomUUID();
  const uuid = randomUUID();
  const email = `billing-${uuid}@test.dev`;

  await db().insert(users).values({
    id,
    uuid,
    email,
    signin_provider: "credential",
    ...(customerId ? { stripe_customer_id: customerId } : {}),
  });

  const org = await ensurePersonalOrganization({ id, email });
  return { user: { id, uuid, email }, orgUuid: org.uuid };
}

async function runBackfill() {
  const file = join(
    __dirname,
    "../../src/db/migrations/0016_backfill_org_stripe_customer.sql"
  );
  await db().execute(sql.raw(readFileSync(file, "utf8")));
}

beforeEach(async () => {
  const seeded = await seedUser();
  user = seeded.user;
  orgUuid = seeded.orgUuid;
});

describeDb("organization Stripe customer (real database)", () => {
  it("stores the customer on the organization", async () => {
    await setOrganizationStripeCustomerId(orgUuid, "cus_team_1");

    const org = await findOrganizationByUuid(orgUuid);
    expect(org?.stripe_customer_id).toBe("cus_team_1");
  });

  it("resolves an organization back from its Stripe customer", async () => {
    await setOrganizationStripeCustomerId(orgUuid, "cus_team_1");

    // This is the second step of the webhook's org attribution. Before the
    // customer was written anywhere it could never match, and attribution
    // silently fell through to the personal-org fallback.
    const org = await findOrganizationByStripeCustomerId("cus_team_1");
    expect(org?.uuid).toBe(orgUuid);
  });

  it("keeps two organizations' customers apart", async () => {
    const other = await seedUser();

    await setOrganizationStripeCustomerId(orgUuid, "cus_a");
    await setOrganizationStripeCustomerId(other.orgUuid, "cus_b");

    expect((await findOrganizationByStripeCustomerId("cus_a"))?.uuid).toBe(orgUuid);
    expect((await findOrganizationByStripeCustomerId("cus_b"))?.uuid).toBe(
      other.orgUuid
    );
  });
});

describeDb("backfill migration 0016 (real database)", () => {
  it("moves an existing user's customer onto their personal org", async () => {
    const legacy = await seedUser("cus_legacy_1");

    await runBackfill();

    const org = await findOrganizationByUuid(legacy.orgUuid);
    expect(org?.stripe_customer_id).toBe("cus_legacy_1");
  });

  it("is idempotent and never reassigns a customer already set", async () => {
    const legacy = await seedUser("cus_legacy_1");
    await setOrganizationStripeCustomerId(legacy.orgUuid, "cus_already_correct");

    await runBackfill();
    await runBackfill();

    const org = await findOrganizationByUuid(legacy.orgUuid);
    expect(org?.stripe_customer_id).toBe("cus_already_correct");
  });

  it("leaves users with no Stripe customer alone", async () => {
    await runBackfill();

    const org = await findOrganizationByUuid(orgUuid);
    expect(org?.stripe_customer_id).toBeNull();
  });

  it("never gives a shared team a member's customer", async () => {
    const legacy = await seedUser("cus_legacy_1");

    // A team created after tenancy existed has no customer to inherit, and
    // adopting one from whoever happens to be a member would put that person's
    // card behind the whole team's subscription.
    const shared = {
      id: randomUUID(),
      uuid: randomUUID(),
      name: "Shared",
      slug: `shared-${randomUUID().slice(0, 8)}`,
      is_personal: false,
    };
    await db().insert(organizations).values(shared);
    await db().execute(
      sql`insert into org_members (id, organization_id, user_id, role)
          values (${randomUUID()}, ${shared.id}, ${legacy.user.id}, 'owner')`
    );

    await runBackfill();

    const [row] = await db()
      .select({ customer: organizations.stripe_customer_id })
      .from(organizations)
      .where(eq(organizations.id, shared.id));

    expect(row.customer).toBeNull();
  });
});
