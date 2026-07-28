/**
 * Database tier: the admin organization search.
 *
 * This is the query behind the console's only cross-tenant view, and every part
 * of it is SQL — an `ilike` across four columns, an aggregate over a LEFT JOIN,
 * and a filter shared with a separate `count(*)`. A mocked model would assert
 * that the query we wrote is the query we wrote.
 *
 * The member count earned its test immediately. The first version used a
 * correlated subquery, and Drizzle renders interpolated columns unqualified
 * inside a `sql` template — so `where "organization_id" = "id"` bound `"id"` to
 * the *inner* table. Both columns exist, nothing errored, and every count came
 * back 0. Only asserting the numbers caught it.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { orgMembers, organizations, subscriptions, users } from "@/db/schema";
import {
  asOrgUuid,
  countOrganizationsForAdmin,
  findOrganizationByUuid,
  listMembersWithUsers,
  listOrganizationsForAdmin,
} from "@/models/organization";
import { listSubscriptionsByOrg } from "@/models/subscription";
import {
  CreditsTransType,
  getOrgCreditSummary,
  increaseCredits,
} from "@/services/credit";
import { getPlanSnapshot } from "@/services/entitlements";

async function seedUser(email: string) {
  const id = randomUUID();
  const uuid = randomUUID();
  await db()
    .insert(users)
    .values({ id, uuid, email, signin_provider: "credential" });
  return { id, uuid, email };
}

async function seedOrg(input: {
  name: string;
  slug: string;
  isPersonal?: boolean;
  stripeCustomerId?: string | null;
  memberEmails?: string[];
}) {
  const id = randomUUID();
  const uuid = randomUUID();

  await db()
    .insert(organizations)
    .values({
      id,
      uuid,
      name: input.name,
      slug: input.slug,
      is_personal: input.isPersonal ?? false,
      stripe_customer_id: input.stripeCustomerId ?? null,
    });

  for (const email of input.memberEmails ?? []) {
    const user = await seedUser(email);
    await db().insert(orgMembers).values({
      id: randomUUID(),
      organization_id: id,
      user_id: user.id,
      role: "member",
    });
  }

  return { id, uuid };
}

useCleanDatabase();

describeDb("admin organization search (real database)", () => {
  beforeEach(async () => {
    await seedOrg({
      name: "Acme Corp",
      slug: "acme",
      stripeCustomerId: "cus_acme_1",
      memberEmails: ["a@acme.test", "b@acme.test", "c@acme.test"],
    });
    await seedOrg({
      name: "Initech",
      slug: "initech",
      stripeCustomerId: "cus_initech_1",
      memberEmails: ["a@initech.test"],
    });
    await seedOrg({
      name: "solo@example.com",
      slug: "solo",
      isPersonal: true,
      memberEmails: ["solo@example.com"],
    });
  });

  it("lists every organization with its member count", async () => {
    const orgs = await listOrganizationsForAdmin({});

    expect(orgs).toHaveLength(3);
    const byName = Object.fromEntries(orgs.map((o) => [o.name, o.member_count]));
    expect(byName).toEqual({
      "Acme Corp": 3,
      Initech: 1,
      "solo@example.com": 1,
    });
  });

  it("returns a full page even when organizations have many members", async () => {
    // The LEFT JOIN multiplies rows per member, so this guards that GROUP BY
    // collapses them *before* LIMIT counts. Acme alone has three member rows; a
    // page of 2 must still mean two organizations, not two joined rows.
    const orgs = await listOrganizationsForAdmin({ limit: 2 });

    expect(orgs).toHaveLength(2);
    expect(new Set(orgs.map((o) => o.uuid)).size).toBe(2);
  });

  it("finds an organization by name, case-insensitively", async () => {
    const orgs = await listOrganizationsForAdmin({ query: "acme" });

    expect(orgs.map((o) => o.name)).toEqual(["Acme Corp"]);
  });

  it("finds an organization by its Stripe customer id", async () => {
    // The lookup that motivated the search box: an operator has a Stripe tab
    // open showing `cus_…` and needs to know whose it is.
    const orgs = await listOrganizationsForAdmin({ query: "cus_initech_1" });

    expect(orgs.map((o) => o.slug)).toEqual(["initech"]);
  });

  it("finds an organization by slug and by uuid", async () => {
    const [acme] = await listOrganizationsForAdmin({ query: "acme" });

    expect(
      (await listOrganizationsForAdmin({ query: "initech" })).map((o) => o.slug)
    ).toEqual(["initech"]);
    expect(
      (await listOrganizationsForAdmin({ query: acme!.uuid })).map((o) => o.uuid)
    ).toEqual([acme!.uuid]);
  });

  it("counts using the same filter it lists with", async () => {
    // A paginator whose total comes from a different filter than its rows is
    // worse than no total: it promises pages that do not exist.
    expect(await countOrganizationsForAdmin()).toBe(3);
    expect(await countOrganizationsForAdmin("acme")).toBe(1);
    expect(await countOrganizationsForAdmin("cus_")).toBe(2);
    expect(await countOrganizationsForAdmin("nothing-matches")).toBe(0);

    for (const query of [undefined, "acme", "cus_", "nothing-matches"]) {
      const rows = await listOrganizationsForAdmin({ query });
      expect(rows).toHaveLength(await countOrganizationsForAdmin(query));
    }
  });

  it("treats a blank search as no search", async () => {
    expect(await listOrganizationsForAdmin({ query: "   " })).toHaveLength(3);
    expect(await countOrganizationsForAdmin("   ")).toBe(3);
  });

  it("distinguishes a personal workspace from a team", async () => {
    // The whole point of the page: the console could previously only ever see
    // the personal one.
    const orgs = await listOrganizationsForAdmin({});
    const personal = orgs.filter((o) => o.is_personal);
    const teams = orgs.filter((o) => !o.is_personal);

    expect(personal.map((o) => o.slug)).toEqual(["solo"]);
    expect(teams.map((o) => o.slug).sort()).toEqual(["acme", "initech"]);
  });

  it("pages without repeating or skipping a row", async () => {
    const first = await listOrganizationsForAdmin({ page: 1, limit: 2 });
    const second = await listOrganizationsForAdmin({ page: 2, limit: 2 });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    const seen = [...first, ...second].map((o) => o.uuid);
    expect(new Set(seen).size).toBe(3);
  });
});

/**
 * The org detail page's data path.
 *
 * Every query here is keyed on the org uuid directly, with no
 * `findPersonalOrganizationByUserUuid` anywhere — which is the entire point.
 * These assertions are the case the console could not previously reach: a team
 * with more than one member, pooled credits, and a Stripe subscription.
 */
describeDb("admin organization detail (real database)", () => {
  it("reads a team's members, pooled credits, plan, and subscription", async () => {
    const org = await seedOrg({
      name: "Acme Team",
      slug: "acme-team",
      stripeCustomerId: "cus_team_1",
    });

    const owner = await seedUser("owner@acme.test");
    const dev = await seedUser("dev@acme.test");
    await db().insert(orgMembers).values([
      { id: randomUUID(), organization_id: org.id, user_id: owner.id, role: "owner" },
      { id: randomUUID(), organization_id: org.id, user_id: dev.id, role: "member" },
    ]);

    // Two different members contribute to one balance — the pooling that makes
    // a per-user view of credits wrong for a team.
    await increaseCredits({
      org_uuid: org.uuid,
      user_uuid: owner.uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: 100,
      order_no: "ord_owner",
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: org.uuid,
      user_uuid: dev.uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: 50,
      order_no: "ord_dev",
      actor: "stripe:webhook",
    });

    await db().insert(subscriptions).values({
      uuid: randomUUID(),
      org_uuid: org.uuid,
      user_uuid: owner.uuid,
      tier: "plus",
      status: "active",
      source: "stripe",
      stripe_subscription_id: "sub_team_1",
      current_period_end: new Date("2026-09-01T00:00:00.000Z"),
      cancel_at_period_end: true,
    });

    const found = await findOrganizationByUuid(org.uuid);
    const [members, credits, plan, subs] = await Promise.all([
      listMembersWithUsers(found!.id),
      getOrgCreditSummary(org.uuid, { includeLedger: true, includeAudit: true }),
      getPlanSnapshot(asOrgUuid(org.uuid)),
      listSubscriptionsByOrg(org.uuid),
    ]);

    // Owners first — the order the screen reads in.
    expect(members.map((m) => `${m.user.email}:${m.member.role}`)).toEqual([
      "owner@acme.test:owner",
      "dev@acme.test:member",
    ]);

    expect(credits.balance).toBe(150);
    expect(credits.ledger.map((l) => l.balanceAfter)).toEqual([150, 100]);
    // Admin surface, so the actor is present.
    expect(credits.ledger.every((l) => l.actor === "stripe:webhook")).toBe(true);

    expect(plan.tier).toBe("plus");
    expect(plan.subscription).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
    });

    // The answer to "I cancelled and I'm still being charged", which the console
    // could not previously give.
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      tier: "plus",
      status: "active",
      source: "stripe",
      cancel_at_period_end: true,
      stripe_subscription_id: "sub_team_1",
    });
  });

  it("shows a comped subscription as manual with no Stripe id", async () => {
    // A comp and a paid subscription resolve through the same entitlement path,
    // so the console has to make the difference visible or an operator cannot
    // tell who is actually paying.
    const org = await seedOrg({ name: "Comped", slug: "comped" });
    const user = await seedUser("comped@acme.test");

    await db().insert(subscriptions).values({
      uuid: randomUUID(),
      org_uuid: org.uuid,
      user_uuid: user.uuid,
      tier: "max",
      status: "active",
      source: "manual",
      stripe_subscription_id: null,
    });

    const subs = await listSubscriptionsByOrg(org.uuid);

    expect(subs[0]).toMatchObject({ source: "manual", tier: "max" });
    expect(subs[0]!.stripe_subscription_id).toBeNull();
  });

  it("reports a free organization rather than failing", async () => {
    // A brand-new org has no subscription row at all. The page must render it as
    // free, not as an error.
    const org = await seedOrg({ name: "Fresh", slug: "fresh" });

    const [plan, subs, credits] = await Promise.all([
      getPlanSnapshot(asOrgUuid(org.uuid)),
      listSubscriptionsByOrg(org.uuid),
      getOrgCreditSummary(org.uuid, { includeAudit: true }),
    ]);

    expect(subs).toEqual([]);
    expect(plan.subscription).toBeNull();
    expect(credits.balance).toBe(0);
  });
});
