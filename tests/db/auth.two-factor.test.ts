/**
 * Exercise Better Auth's real adapter against the enrollment and lockout
 * columns. A schema-only test cannot catch a missing camelCase field mapping or
 * a pending enrollment accidentally becoming a usable second factor.
 */
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";
import { db } from "@/db";
import { accounts, twoFactor, users } from "@/db/schema";

const PASSWORD = "two-factor-test-password-123";

function cookies(headers: Headers): Headers {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
}

/** An independent RFC 6238 authenticator for the enrollment URI. */
function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret")!;
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((character) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(character)
        .toString(2)
        .padStart(5, "0"),
    )
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}

describeDb("two-factor enrollment (real auth stack)", () => {
  useCleanDatabase();

  it("verifies enrollment and persists failed attempts and account lockout", async () => {
    const { auth } = await import("@/lib/auth");
    const id = randomUUID();
    const email = `two-factor-${id}@example.com`;
    await db().insert(users).values({
      id,
      uuid: randomUUID(),
      email,
      signin_provider: "credential",
      email_verified: true,
    });
    await db()
      .insert(accounts)
      .values({
        id: randomUUID(),
        user_id: id,
        account_id: id,
        provider_id: "credential",
        password: await hashPassword(PASSWORD),
      });

    const signedIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const headers = cookies(signedIn.headers);
    const enrollment = await auth.api.enableTwoFactor({
      body: { password: PASSWORD, method: "totp" },
      headers,
    });
    if (enrollment.method !== "totp")
      throw new Error("Expected TOTP enrollment");
    expect(enrollment.totpURI).toMatch(/^otpauth:\/\/totp\//);

    const [pending] = await db()
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.user_id, id));
    expect(pending).toMatchObject({
      verified: false,
      failed_verification_count: 0,
      locked_until: null,
    });

    await auth.api.verifyTOTP({
      body: { code: totp(enrollment.totpURI) },
      headers,
    });
    const [verified] = await db()
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.user_id, id));
    const [user] = await db().select().from(users).where(eq(users.id, id));
    expect(verified.verified).toBe(true);
    expect(user.two_factor_enabled).toBe(true);

    const challenge = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    expect(challenge.response).toMatchObject({ twoFactorRedirect: true });
    await expect(
      auth.api.verifyTOTP({
        body: { code: "invalid" },
        headers: cookies(challenge.headers),
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_CODE" } });

    const [failed] = await db()
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.user_id, id));
    expect(failed.failed_verification_count).toBe(1);

    // A persisted account lock must apply to a fresh sign-in challenge too.
    await db()
      .update(twoFactor)
      .set({
        locked_until: new Date(Date.now() + 60_000),
      })
      .where(eq(twoFactor.user_id, id));
    const lockedChallenge = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    await expect(
      auth.api.verifyTOTP({
        body: { code: totp(enrollment.totpURI) },
        headers: cookies(lockedChallenge.headers),
      }),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_TEMPORARILY_LOCKED" } });
  });
});
