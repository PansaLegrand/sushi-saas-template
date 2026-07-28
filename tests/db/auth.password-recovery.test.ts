/**
 * Database tier: giving a provider-only account a password.
 *
 * Two claims are checked here that only the real auth stack can settle.
 *
 * **The reset flow works for an account that has never had a password.** This
 * is the documented way out of the dead end where a Google-only admin cannot
 * enable two-factor auth; if `resetPassword` refused when no `credential`
 * account existed, that advice would be wrong.
 *
 * **`AUTH_DEV_EMAIL_LINKS` actually diverts the mail.** The flag's logic has
 * unit tests, but the thing that matters is whether `src/lib/auth.ts` consults
 * it before calling the provider — a flag nothing reads is worse than no flag,
 * because the operator believes local signups have stopped emailing real people.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  sendResetPasswordEmail: vi.fn(),
  sendVerifyEmail: vi.fn(),
}));

// Stands in for Resend. Asserting this was *not* called is the whole point:
// it is the difference between "the link was logged" and "the link was logged
// and also emailed to a real person".
vi.mock("@/services/email/send", () => ({
  sendResetPasswordEmail: mocks.sendResetPasswordEmail,
  sendVerifyEmail: mocks.sendVerifyEmail,
}));

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { accounts, users, verifications } from "@/db/schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { hasPasswordCredential, listAccountProviders } from "@/models/account";

useCleanDatabase();

const DOMAIN = "recovery.example.com";

/**
 * Pin the email configuration for one test.
 *
 * `getAppEnv()` caches, and `src/lib/auth.ts` reads it per request rather than
 * at import, so clearing the cache after stubbing is enough to change what the
 * next call sees — no module reset needed.
 */
function withEnv(
  provider: { RESEND_API_KEY: string; EMAIL_FROM: string },
  devLinks: boolean
) {
  vi.stubEnv("RESEND_API_KEY", provider.RESEND_API_KEY);
  vi.stubEnv("EMAIL_FROM", provider.EMAIL_FROM);
  vi.stubEnv("AUTH_DEV_EMAIL_LINKS", devLinks ? "true" : "false");
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

/** A Google-only account, exactly as Better Auth's OAuth callback creates it. */
async function seedProviderOnlyUser(email: string) {
  const id = randomUUID();

  await db().insert(users).values({
    id,
    uuid: randomUUID(),
    email,
    signin_provider: "google",
    email_verified: true,
  });

  await db().insert(accounts).values({
    id: randomUUID(),
    user_id: id,
    account_id: id,
    provider_id: "google",
    // The point of the fixture: no password column.
  });

  return id;
}

let email: string;

beforeEach(() => {
  vi.clearAllMocks();
  email = `oauth-${randomUUID().slice(0, 8)}@${DOMAIN}`;
});

describeDb("provider-only accounts (real database)", () => {
  it("reports that the account has no password", async () => {
    // What the two-factor panel branches on. Getting this wrong in either
    // direction shows the user the wrong form.
    const id = await seedProviderOnlyUser(email);

    expect(await hasPasswordCredential(id)).toBe(false);
    expect(await listAccountProviders(id)).toEqual(["google"]);
  });

  it("does not count a credential row that carries no hash", async () => {
    // `provider_id = 'credential'` alone is not "has a password": a row can
    // exist with a null hash, and treating that as a password puts the user
    // straight back at the prompt nothing can satisfy.
    const id = await seedProviderOnlyUser(email);
    await db().insert(accounts).values({
      id: randomUUID(),
      user_id: id,
      account_id: id,
      provider_id: "credential",
    });

    expect(await hasPasswordCredential(id)).toBe(false);
  });

  it("creates the credential account when a reset completes", async () => {
    // Validates the recommended way out: `resetPassword` branches on a missing
    // credential account and creates one rather than refusing.
    const { auth } = await import("@/lib/auth");
    const id = await seedProviderOnlyUser(email);

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
      headers: new Headers(),
    });

    // The token Better Auth stored for this reset, read the way the emailed
    // link would carry it.
    const rows = await db().select().from(verifications);
    const entry = rows.find((row) => row.identifier.startsWith("reset-password:"));
    expect(entry, "no reset token was issued").toBeDefined();

    await auth.api.resetPassword({
      body: {
        newPassword: "a-brand-new-password",
        token: entry!.identifier.replace("reset-password:", ""),
      },
      headers: new Headers(),
    });

    expect(await hasPasswordCredential(id)).toBe(true);

    const linked = await db()
      .select()
      .from(accounts)
      .where(eq(accounts.user_id, id));
    expect(linked.map((row) => row.provider_id).sort()).toEqual([
      "credential",
      "google",
    ]);
  });

  it("emails the reset link when a provider is configured and the flag is off", async () => {
    // The control. Without it, the assertion below would pass just as happily
    // on a build where the email service is broken outright.
    withEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "T <t@example.com>" }, false);

    const { auth } = await import("@/lib/auth");
    await seedProviderOnlyUser(email);

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
      headers: new Headers(),
    });

    expect(mocks.sendResetPasswordEmail).toHaveBeenCalledWith(
      email,
      expect.stringContaining("/reset-password/")
    );
  });

  it("logs the reset link instead of emailing it when AUTH_DEV_EMAIL_LINKS is on", async () => {
    // The flag's whole value: a real Resend key stays in `.env` and no local
    // signup or reset touches a real inbox. Stubbed rather than read from the
    // ambient env, so the result does not depend on whose machine is running it.
    withEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "T <t@example.com>" }, true);

    const { auth } = await import("@/lib/auth");
    await seedProviderOnlyUser(email);

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "http://localhost:3000/reset-password" },
      headers: new Headers(),
    });

    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled();
  });
});
