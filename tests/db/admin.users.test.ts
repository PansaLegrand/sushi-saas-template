/**
 * Database tier: the admin user search.
 *
 * All of this is SQL — an `ilike` across three columns, a filter shared with a
 * separate `count(*)`, and a column allowlist expressed as a select list. A
 * mocked model would assert that the query we wrote is the query we wrote, and
 * would not notice the two failures that matter here: a `count` computed from a
 * different filter than the rows, and a select that quietly returns columns the
 * browser must never see.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  countAdminUsers,
  countAdminUsersSince,
  listAdminUsers,
} from "@admin/lib/data";

async function seedUser(input: {
  email: string;
  nickname?: string;
  uuid?: string;
  createdAt?: Date;
  signinProvider?: string;
  bannedAt?: Date | null;
}) {
  const id = randomUUID();
  const uuid = input.uuid ?? randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      uuid,
      email: input.email,
      nickname: input.nickname ?? "",
      signin_provider: input.signinProvider ?? "credential",
      created_at: input.createdAt ?? new Date(),
      banned_at: input.bannedAt ?? null,
      // The columns the console must never ship to a browser. Populated so the
      // allowlist assertion below is testing something.
      signin_ip: "203.0.113.9",
      stripe_customer_id: "cus_secret",
      invite_code: "INVITE-SECRET",
      signin_openid: "openid-secret",
    });

  return { id, uuid, email: input.email };
}

describeDb("admin user search", () => {
  useCleanDatabase();

  it("finds an account by address, regardless of case", async () => {
    await seedUser({ email: "Ann.Smith@corp.example" });
    await seedUser({ email: "bob@other.example" });

    const rows = await listAdminUsers({ query: "ANN.SMITH" });

    expect(rows.map((r) => r.email)).toEqual(["Ann.Smith@corp.example"]);
  });

  it("finds an account by a fragment of its uuid", async () => {
    // The lookup an operator does from a log line, where the id is truncated.
    const uuid = "0192f3a1-dead-7000-8000-abcdefabcdef";
    await seedUser({ email: "ann@corp.example", uuid });
    await seedUser({ email: "bob@other.example" });

    const rows = await listAdminUsers({ query: "dead-7000" });

    expect(rows.map((r) => r.uuid)).toEqual([uuid]);
  });

  it("finds an account by nickname", async () => {
    await seedUser({ email: "ann@corp.example", nickname: "Annie" });
    await seedUser({ email: "bob@other.example", nickname: "Bobby" });

    const rows = await listAdminUsers({ query: "annie" });

    expect(rows.map((r) => r.email)).toEqual(["ann@corp.example"]);
  });

  it("matches every account on an address, not just one provider's row", async () => {
    // `users.email` is unique per signin_provider, so one address is several
    // rows. A search that showed one of them would send an operator to suspend
    // an account while its sibling stayed open.
    await seedUser({ email: "ann@corp.example", signinProvider: "credential" });
    await seedUser({ email: "ann@corp.example", signinProvider: "google" });

    const rows = await listAdminUsers({ query: "ann@corp.example" });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.signin_provider))).toEqual(
      new Set(["credential", "google"])
    );
  });

  it("counts through the same filter the rows came from", async () => {
    await seedUser({ email: "ann@corp.example" });
    await seedUser({ email: "andy@corp.example" });
    await seedUser({ email: "bob@other.example" });

    expect(await countAdminUsers("corp.example")).toBe(2);
    expect(await countAdminUsers()).toBe(3);
    expect(await countAdminUsers("nobody")).toBe(0);
  });

  it("treats a blank search as no filter rather than as a match on nothing", async () => {
    await seedUser({ email: "ann@corp.example" });
    await seedUser({ email: "bob@other.example" });

    expect(await listAdminUsers({ query: "   " })).toHaveLength(2);
    expect(await countAdminUsers("   ")).toBe(2);
  });

  it("returns the newest first, and pages without repeating a row", async () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 3; i++) {
      await seedUser({
        email: `user${i}@corp.example`,
        createdAt: new Date(base + i * 86_400_000),
      });
    }

    const first = await listAdminUsers({ page: 1, limit: 2 });
    const second = await listAdminUsers({ page: 2, limit: 2 });

    expect(first.map((r) => r.email)).toEqual([
      "user2@corp.example",
      "user1@corp.example",
    ]);
    expect(second.map((r) => r.email)).toEqual(["user0@corp.example"]);
  });

  it("reports suspension state, so a search result is actionable on its own", async () => {
    const bannedAt = new Date("2026-07-01T00:00:00.000Z");
    await seedUser({ email: "ann@corp.example", bannedAt });

    const [row] = await listAdminUsers({ query: "ann@corp.example" });

    expect(row.banned_at?.toISOString()).toBe(bannedAt.toISOString());
  });

  it("counts signups inside a window and ignores the ones before it", async () => {
    // Backs the overview's signup rate, which is there to make a bot wave show
    // up as a number. A window that quietly included old rows would flatten
    // exactly the spike it exists to reveal.
    const now = Date.now();
    await seedUser({
      email: "old@corp.example",
      createdAt: new Date(now - 30 * 86_400_000),
    });
    await seedUser({
      email: "recent@corp.example",
      createdAt: new Date(now - 2 * 86_400_000),
    });
    await seedUser({ email: "today@corp.example", createdAt: new Date(now) });

    const sevenDaysAgo = new Date(now - 7 * 86_400_000);

    expect(await countAdminUsersSince(sevenDaysAgo)).toBe(2);
    expect(await countAdminUsers()).toBe(3);
  });

  it("never returns a column the console keeps out of the browser", async () => {
    // The search path is new; the allowlist is the reason `signin_ip` and
    // `stripe_customer_id` have never reached a page. Asserted on the *keys*,
    // because the way this breaks is a bare `select()` added by someone who
    // needed one more column and did not know why the list was there.
    await seedUser({ email: "ann@corp.example" });

    const [row] = await listAdminUsers({ query: "ann" });
    const keys = Object.keys(row);

    for (const forbidden of [
      "signin_ip",
      "signin_openid",
      "stripe_customer_id",
      "invite_code",
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    expect(keys).toContain("uuid");
    expect(keys).toContain("email");
  });
});
