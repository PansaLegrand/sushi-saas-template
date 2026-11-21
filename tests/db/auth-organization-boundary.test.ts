/** Public SDK routes must not bypass the application's locked membership writes. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describeDb, useCleanDatabase } from "./setup";
import { db } from "@/db";
import { accounts, orgMembers, users } from "@/db/schema";
import { ensurePersonalOrganization } from "@/services/organizations";

describeDb("public organization mutation boundary", () => {
  useCleanDatabase();

  it("refuses direct SDK leave while retaining the user's last membership", async () => {
    const { auth } = await import("@/lib/auth");
    const web = await import("@/app/api/auth/[...all]/route");
    const admin = await import("@admin/app/api/auth/[...all]/route");
    const id = randomUUID();
    const email = `${id}@example.com`;
    const password = "review-membership-password-123";
    await db().insert(users).values({ id, uuid: randomUUID(), email, email_verified: true, signin_provider: "credential" });
    await db().insert(accounts).values({ id: randomUUID(), user_id: id, account_id: id, provider_id: "credential", password: await hashPassword(password) });
    const org = await ensurePersonalOrganization({ id, email });
    // A non-owner with one membership is enough to expose the bypass. The
    // application refuses this removal, but the SDK does not know that rule.
    await db().update(orgMembers).set({ role: "member" }).where(eq(orgMembers.user_id, id));
    const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    for (const handler of [web, admin]) {
      for (const endpoint of ["invite-member", "accept-invitation", "reject-invitation", "cancel-invitation", "add-member", "remove-member", "update-member-role", "leave"]) {
        const url = `http://localhost:3000/api/auth/organization/${endpoint}`;
        const response = await handler.POST(new Request(url, {
          method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({ organizationId: org.id }),
        }));
        expect(response.status).toBe(403);
        expect((await handler.GET(new Request(url, { headers: { cookie } }))).status).toBe(403);
      }
    }
    expect(await db().select().from(orgMembers).where(eq(orgMembers.user_id, id))).toHaveLength(1);

    // Model a ban whose session deletion failed, or a session created by an
    // in-flight login after revocation. Both SDK and app access must close.
    await db().update(users).set({ banned_at: new Date() }).where(eq(users.id, id));
    await expect(auth.api.listOrganizations({ headers: new Headers({ cookie }) })).rejects.toMatchObject({
      body: { code: "ACCOUNT_SUSPENDED" },
    });
    const { getOrgContextFromHeaders } = await import("@/services/authz");
    // getSession itself now refuses a suspended identity before resolving a tenant.
    await expect(getOrgContextFromHeaders(new Headers({ cookie }))).rejects.toMatchObject({
      body: { code: "ACCOUNT_SUSPENDED" },
    });
    await expect(auth.api.signOut({ headers: new Headers({ cookie }) })).resolves.toMatchObject({ success: true });
  });
});
