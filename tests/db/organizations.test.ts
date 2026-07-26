/**
 * Database tier: the tenancy tables and their Better Auth mapping.
 *
 * The organization plugin owns `organizations`, `org_members`, and
 * `org_invitations`, but this repo names columns in snake_case, so every
 * logical field is mapped by hand in `src/lib/auth.ts`. A missing or misspelled
 * mapping compiles fine and fails on the first write — which is precisely the
 * kind of bug that reaches production. These tests drive real writes through
 * `auth.api` so the mapping is checked, not assumed.
 *
 * They also pin the two invariants the schema enforces rather than the code:
 * one membership per user per org, and a non-null `uuid` on every org.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

import { UNIQUE_VIOLATION, describeDb, errorCode, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { orgMembers, organizations, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { findMembershipsByUserId } from "@/models/organization";
import { ensurePersonalOrganization } from "@/services/organizations";

async function newUser(email = `owner-${randomUUID()}@test.dev`) {
  const row = {
    id: randomUUID(),
    uuid: randomUUID(),
    email,
    signin_provider: "credential",
  } satisfies typeof users.$inferInsert;

  await db().insert(users).values(row);
  return row;
}

/**
 * Server-side org creation with no session. `createOrganization` accepts a
 * `userId` when it is called without a request, which is the same path the
 * signup hook uses to mint a personal org before any session exists.
 */
async function createOrg(userId: string, name: string) {
  return auth.api.createOrganization({
    body: { name, slug: `${name}-${randomUUID().slice(0, 8)}`, userId },
  });
}

// Once for the file, not once per block: the harness closes the shared
// connection in `afterAll`, so a second registration would tear the pool down
// while the blocks below are still running.
useCleanDatabase();

describeDb("organization tenancy (real database)", () => {
  it("writes an organization through the mapped snake_case columns", async () => {
    const user = await newUser();

    const org = await createOrg(user.id, "acme");
    expect(org).toBeTruthy();

    const [row] = await db()
      .select()
      .from(organizations)
      .where(eq(organizations.id, org!.id));

    expect(row).toBeDefined();
    expect(row.name).toBe("acme");
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("gives every organization a uuid for application tables to reference", async () => {
    const user = await newUser();

    const org = await createOrg(user.id, "with-uuid");

    const [row] = await db()
      .select()
      .from(organizations)
      .where(eq(organizations.id, org!.id));

    // NOT NULL in the schema, generated in the `beforeCreate` hook. If the hook
    // stops firing, this insert fails outright rather than writing a row that
    // nothing can reference.
    expect(row.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("makes the creator an owner", async () => {
    const user = await newUser();

    const org = await createOrg(user.id, "owned");

    const [member] = await db()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.organization_id, org!.id));

    expect(member).toBeDefined();
    expect(member.user_id).toBe(user.id);
    // `creatorRole: "owner"` — ownership must never be an implicit consequence
    // of someone else being promoted.
    expect(member.role).toBe("owner");
  });

  it("rejects a second membership for the same user in one org", async () => {
    const user = await newUser();
    const org = await createOrg(user.id, "dedupe");

    const error = await db()
      .insert(orgMembers)
      .values({
        id: randomUUID(),
        organization_id: org!.id,
        user_id: user.id,
        role: "member",
      })
      .catch((e) => e);

    // Without this index a double-accepted invitation leaves two rows and
    // whichever the query happens to read first decides the user's role.
    expect(errorCode(error)).toBe(UNIQUE_VIOLATION);
  });

  it("keeps organization slugs unique across tenants", async () => {
    const first = await newUser();
    const second = await newUser();

    const org = await createOrg(first.id, "shared-slug");
    const [row] = await db()
      .select()
      .from(organizations)
      .where(eq(organizations.id, org!.id));

    const error = await auth.api
      .createOrganization({
        body: { name: "shared-slug", slug: row.slug, userId: second.id },
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
  });
});

describeDb("personal organizations (real database)", () => {
  it("creates a personal org owned by the user", async () => {
    const user = await newUser("alice@test.dev");

    const org = await ensurePersonalOrganization({
      id: user.id,
      email: user.email,
      nickname: "",
    });

    expect(org.is_personal).toBe(true);
    // Derived from the local part, so the org name never carries the full
    // address into a screen every member can see.
    expect(org.name).toBe("alice");

    const [member] = await db()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.user_id, user.id));

    expect(member.role).toBe("owner");
  });

  it("names the workspace after the person when a display name exists", async () => {
    const user = await newUser("a.long.address@test.dev");

    const org = await ensurePersonalOrganization({
      id: user.id,
      email: user.email,
      nickname: "Ada Lovelace",
    });

    // The caller has to read Better Auth's *logical* `name` field to get here;
    // reading the `nickname` column directly yields undefined in a create hook,
    // which silently named every workspace after an email local part instead.
    expect(org.name).toBe("Ada Lovelace");
    expect(org.slug).toMatch(/^ada-lovelace-[0-9a-f]{8}$/);
  });

  it("is idempotent — a second call creates nothing", async () => {
    const user = await newUser();

    const first = await ensurePersonalOrganization({ id: user.id, email: user.email });
    const second = await ensurePersonalOrganization({ id: user.id, email: user.email });

    expect(second.id).toBe(first.id);

    // The repair path in `getOrgContext()` runs this on requests that find no
    // membership. If it were not idempotent it would mint an org per request.
    const memberships = await findMembershipsByUserId(user.id);
    expect(memberships).toHaveLength(1);
  });

  it("prefers a personal org when the user belongs to several", async () => {
    const user = await newUser();
    const personal = await ensurePersonalOrganization({ id: user.id, email: user.email });

    // Joining a second org must not change where a fresh session lands.
    await createOrg(user.id, "some-team");

    const resolved = await ensurePersonalOrganization({ id: user.id, email: user.email });
    expect(resolved.id).toBe(personal.id);
  });

  it("gives distinct users distinct slugs", async () => {
    // Both derive the same stem; only the random suffix keeps the unique index
    // from rejecting the second signup.
    const a = await newUser("sam@test.dev");
    const b = await newUser("sam@other.dev");

    const first = await ensurePersonalOrganization({ id: a.id, email: a.email });
    const second = await ensurePersonalOrganization({ id: b.id, email: b.email });

    expect(first.slug).not.toBe(second.slug);
    expect(first.name).toBe(second.name);
  });
});

describeDb("backfill migration 0012 (real database)", () => {
  /**
   * Run the shipped migration rather than a copy of it. A data migration that
   * is tested by re-implementing its logic in the test proves only that two
   * pieces of SQL agree with each other.
   */
  async function runBackfill() {
    const file = join(
      __dirname,
      "../../src/db/migrations/0012_backfill_personal_organizations.sql"
    );
    await db().execute(sql.raw(readFileSync(file, "utf8")));
  }

  it("gives every pre-tenancy user an org they own", async () => {
    const user = await newUser("legacy@test.dev");

    await runBackfill();

    const memberships = await findMembershipsByUserId(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].member.role).toBe("owner");
    expect(memberships[0].organization.is_personal).toBe(true);
    expect(memberships[0].organization.name).toBe("legacy");
    expect(memberships[0].organization.uuid).toBeTruthy();
  });

  it("is idempotent", async () => {
    const user = await newUser();

    await runBackfill();
    await runBackfill();

    // Re-running a data migration is normal — a deploy retries, or someone
    // applies it to a database that was already partly migrated.
    expect(await findMembershipsByUserId(user.id)).toHaveLength(1);
  });

  it("leaves users who already have an org alone", async () => {
    const user = await newUser();
    const existing = await ensurePersonalOrganization({ id: user.id, email: user.email });

    await runBackfill();

    const memberships = await findMembershipsByUserId(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].organization.id).toBe(existing.id);
  });
});
