import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { captcha, organization, twoFactor } from "better-auth/plugins";
import { createFieldAttribute } from "better-auth/db";

import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { CAPTCHA_PROTECTED_ENDPOINTS } from "@/lib/captcha";
import { absoluteWithLocale } from "@/config/auth";
import { getAppEnv, isProductionRuntime } from "@/lib/env";
import { findUserById } from "@/models/user";
import {
  describeAuthRequest,
  recordAuthEvent,
  touchLastSignin,
} from "@/services/auth-events";
import { CreditsAmount } from "@/services/credit";
import { enqueueJobSafe } from "@/services/jobs";
import { checkSignupAllowed, isUserIdBanned } from "@/services/moderation";
import { ensurePersonalOrganization } from "@/services/organizations";
import { sendResetPasswordEmail, sendVerifyEmail } from "@/services/email/send";
import {
  hasEmailProviderConfigured,
  logDevAuthEmailLink,
  shouldLogAuthLinkInsteadOfSending,
  type AuthEmailLinkKind,
} from "@/services/email/dev-auth-links";
import * as schema from "@/db/schema";
import { logger } from "@/lib/logger/server";

const database = db();

function getAuthSecret() {
  const secret = getAppEnv().BETTER_AUTH_SECRET;
  if (secret) {
    return secret;
  }

  if (isProductionRuntime()) {
    throw new Error("BETTER_AUTH_SECRET must be set in production");
  }

  return "sushi-saas-template-local-dev-auth-secret";
}

const socialProviders = (() => {
  const env = getAppEnv();
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (id && secret) {
    return {
      google: {
        clientId: id,
        clientSecret: secret,
        accessType: "offline",
        prompt: "select_account",
      },
    } as const;
  }
  return {} as const;
})();

async function sendAuthEmailOrLogDevLink(input: {
  kind: AuthEmailLinkKind;
  email: string;
  url: string;
  send: () => Promise<unknown>;
}) {
  if (shouldLogAuthLinkInsteadOfSending()) {
    logDevAuthEmailLink({
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: hasEmailProviderConfigured()
        ? "dev_email_links_enabled"
        : "email_provider_missing",
    });
    return;
  }

  try {
    await input.send();
  } catch (error) {
    const loggedDevLink = logDevAuthEmailLink({
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: "email_send_failed",
    });

    if (!loggedDevLink) {
      logger.error(
        { err: error, event: "auth.email_send_failed", kind: input.kind },
        "failed to send auth email"
      );
    }
  }
}

/**
 * Turnstile challenge on the credential and mail-sending endpoints.
 *
 * Registered only when a secret key is present. `validateAppEnv()` makes the
 * key mandatory in production unless `NEXT_PUBLIC_CAPTCHA_ENABLED=false`, so a
 * production deployment cannot silently end up with no bot protection.
 */
const captchaPlugins = (() => {
  const env = getAppEnv();
  const secretKey = env.TURNSTILE_SECRET_KEY;

  if (!env.NEXT_PUBLIC_CAPTCHA_ENABLED || !secretKey) {
    if (isProductionRuntime() && !env.NEXT_PUBLIC_CAPTCHA_ENABLED) {
      logger.warn(
        { event: "auth.captcha_disabled" },
        "captcha is disabled: auth endpoints have no bot protection"
      );
    }
    return [];
  }

  return [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey,
      endpoints: [...CAPTCHA_PROTECTED_ENDPOINTS],
    }),
  ];
})();

/** 72 hours. Referenced by both the plugin and the email that quotes it. */
const INVITATION_EXPIRES_IN_SECONDS = 72 * 60 * 60;

/**
 * Tenancy.
 *
 * Roles are the plugin's defaults — `owner`, `admin`, `member` — and they govern
 * *membership* operations only: who may invite, remove, or change a role. They
 * deliberately say nothing about who may delete a file or spend a credit. That
 * is `can()` in `src/services/authz`, which is a separate axis from plan
 * entitlements. Three checks, three questions:
 *
 *   can(ctx, "file:delete", file)      → does this member's role allow it
 *   hasEntitlement(plan, "storage")    → does this org's plan include it
 *   auth.api.hasPermission(...)        → may they manage the membership itself
 *
 * Teams and dynamic access control are both off. Each is additive later — the
 * plugin creates their tables only when the option is enabled — so leaving them
 * off costs nothing and keeps three tables out of a fresh install.
 */
const organizationPlugin = organization({
  // The tables live in `src/db/schema.ts` under the repo's snake_case
  // convention, so every logical field needs an explicit mapping. A missing
  // entry fails at runtime on first write, not at build time.
  //
  // `modelName` here is the *export key* in `@/db/schema` — the Drizzle adapter
  // resolves it as `schema[modelName]` — not the SQL table name. The SQL name
  // comes from the `pgTable(...)` call itself, so `orgMembers` below is the
  // export that backs the `org_members` table.
  schema: {
    organization: {
      modelName: "organizations",
      fields: {
        createdAt: "created_at",
      },
      additionalFields: {
        uuid: createFieldAttribute("string", {
          unique: true,
          input: false,
          fieldName: "uuid",
        }),
        stripe_customer_id: createFieldAttribute("string", {
          required: false,
          input: false,
          fieldName: "stripe_customer_id",
        }),
        is_personal: createFieldAttribute("boolean", {
          required: false,
          input: false,
          fieldName: "is_personal",
        }),
      },
    },
    member: {
      modelName: "orgMembers",
      fields: {
        organizationId: "organization_id",
        userId: "user_id",
        createdAt: "created_at",
      },
    },
    invitation: {
      modelName: "orgInvitations",
      fields: {
        organizationId: "organization_id",
        inviterId: "inviter_id",
        expiresAt: "expires_at",
      },
    },
    session: {
      fields: {
        activeOrganizationId: "active_organization_id",
      },
    },
  },

  // Whoever creates an org owns it. Ownership transfer is an explicit action,
  // never an implicit consequence of someone else being promoted to admin.
  creatorRole: "owner",

  /** Long enough to survive a weekend, short enough that a leaked link expires. */
  invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,

  // Re-inviting the same address supersedes the pending invitation rather than
  // stacking a second one. Two live invitations for one email means two accept
  // links, and whichever is clicked second fails confusingly.
  cancelPendingInvitationsOnReInvite: true,

  sendInvitationEmail: async ({ id, email, organization, inviter }) => {
    // Queued, not sent inline: the invite request should not fail because
    // Resend is briefly down, and a serverless instance can freeze before an
    // un-awaited send completes. The job table gives retries and a record.
    await enqueueJobSafe(
      "org_invitation_email",
      {
        to: email,
        url: absoluteWithLocale(undefined, `/invitations/${id}`),
        organizationName: organization.name,
        inviterName: inviter.user?.name || undefined,
        expiresInHours: INVITATION_EXPIRES_IN_SECONDS / 3600,
      },
      { dedupeKey: `org_invitation_email:${id}` }
    );
  },

  organizationCreation: {
    beforeCreate: async ({ organization: org }) => {
      // `organizations.uuid` is NOT NULL and is what every application table
      // references. Generating it here rather than in a database default keeps
      // one rule: Better Auth owns `id`, the app owns `uuid`.
      return { data: { ...org, uuid: randomUUID() } };
    },
  },
});

const twoFactorPlugin = twoFactor({
  issuer: getAppEnv().NEXT_PUBLIC_APP_NAME,
  schema: {
    user: {
      fields: {
        twoFactorEnabled: "two_factor_enabled",
      },
    },
    twoFactor: {
      modelName: "twoFactor",
      fields: {
        userId: "user_id",
        backupCodes: "backup_codes",
      },
    },
  },
});

export const auth = betterAuth({
  appName: getAppEnv().NEXT_PUBLIC_APP_NAME,
  baseURL: getAppEnv().BETTER_AUTH_URL,
  secret: getAuthSecret(),
  database: drizzleAdapter(database, {
    schema,
    provider: "pg",
  }),
  socialProviders,
  user: {
    modelName: "users",
    fields: {
      name: "nickname",
      image: "avatar_url",
      createdAt: "created_at",
      updatedAt: "updated_at",
      emailVerified: "email_verified",
    },
    additionalFields: {
      uuid: createFieldAttribute("string", {
        unique: true,
        input: false,
        fieldName: "uuid",
      }),
      role: createFieldAttribute("string", {
        input: false,
        fieldName: "role",
      }),
    },
  },
  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      activeOrganizationId: "active_organization_id",
    },
  },
  account: {
    modelName: "accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      scope: "scope",
      idToken: "id_token",
      password: "password",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verifications",
    fields: {
      identifier: "identifier",
      value: "value",
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }, _request) => {
      await sendAuthEmailOrLogDevLink({
        kind: "password_reset",
        email: user.email,
        url,
        send: () => sendResetPasswordEmail(user.email, url),
      });
    },
    onPasswordReset: async ({ user }, _request) => {
      // Identify by id, not email. An interpolated address cannot be redacted
      // and ends up in every log sink this stream is piped to.
      logger.info(
        { event: "auth.password_reset_completed", user_id: user.id },
        "password reset completed"
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }, _request) => {
      await sendAuthEmailOrLogDevLink({
        kind: "verification",
        email: user.email,
        url,
        send: () => sendVerifyEmail(user.email, url),
      });
    },
    afterEmailVerification: async (user, request) => {
      const info = describeAuthRequest({ request, path: "/verify-email" });
      const userUuid = (user as any).uuid as string | undefined;

      await recordAuthEvent({
        event: "email_verified",
        userUuid,
        userId: user.id,
        email: user.email,
        info,
      });

      // Signup credits are granted here rather than on user creation: an
      // unverified address costs an attacker nothing, so granting earlier
      // would pay out for every throwaway signup.
      if (userUuid && CreditsAmount.NewUserGet > 0) {
        await enqueueJobSafe(
          "new_user_credits",
          { userUuid, credits: CreditsAmount.NewUserGet },
          { dedupeKey: `new_user_credits:${userUuid}` }
        );
      }
    },
  },
  // Captcha first: its onRequest hook must reject before any handler runs.
  // `nextCookies` stays last — it wraps responses, so anything registered after
  // it would not get its cookies written.
  plugins: [...captchaPlugins, organizationPlugin, twoFactorPlugin, nextCookies()],
  telemetry: {
    enabled: false,
  },
  advanced: {
    defaultCookieAttributes: {
      secure: process.env.NODE_ENV === "production",
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (data, context) => {
          const info = describeAuthRequest(context);

          // The signup gate.
          //
          // Here rather than on `/sign-up/email` because this hook is the one
          // point *every* signup passes through, OAuth included — and OAuth is
          // the path with no captcha in front of it. A blocklist wired to the
          // credential endpoint alone leaves "continue with Google" open, which
          // is exactly how a banned address gets back in.
          const email = (data as { email?: string }).email;
          const check = await checkSignupAllowed(email);
          if (!check.allowed) {
            logger.warn(
              {
                event: "auth.signup_blocked",
                reason: check.reason,
                matched: check.matchedValue,
                provider: info.provider,
                ip: info.ip,
              },
              "signup rejected by blocklist"
            );

            // The message doubles as the catalog code so `resolveAuthError`
            // translates it, rather than rendering this English on the form.
            throw new APIError("FORBIDDEN", {
              code: "ACCOUNT_SIGNUP_BLOCKED",
              message: "ACCOUNT_SIGNUP_BLOCKED",
            });
          }

          return {
            data: {
              ...data,
              uuid: data.uuid ?? randomUUID(),
              // Provenance, written at insert time. These columns previously
              // stayed null forever, which also left the
              // (email, signin_provider) unique index unenforced.
              signin_provider: data.signin_provider ?? info.provider,
              signin_type: data.signin_type ?? (info.provider ? "oauth" : ""),
              signin_ip: data.signin_ip ?? info.ip ?? "",
            },
          };
        },
        after: async (created, context) => {
          const info = describeAuthRequest(context);
          const email = (created as any).email as string | undefined;
          // Better Auth hands hooks its *logical* model, so the display name
          // arrives as `name` even though it is stored in the `nickname`
          // column. Reading only the column name yielded undefined here, which
          // silently addressed every welcome email to nobody and named every
          // personal organization after the email local part instead of the
          // person. Both spellings are accepted so a future mapping change
          // cannot reintroduce it.
          const name =
            ((created as any).name as string | undefined) ||
            ((created as any).nickname as string | undefined);
          const userUuid = (created as any).uuid as string | undefined;

          await recordAuthEvent({
            event: "signup",
            userUuid,
            userId: (created as any).id as string | undefined,
            email,
            info,
          });

          // Every user gets an organization, immediately.
          //
          // Deliberately here and not at email verification, where signup
          // credits are granted. Credits wait because an unverified address
          // costs an attacker nothing; an org is not a payout, it is the thing
          // that makes the account addressable at all. A user without one has
          // no scope to read or write in, so creating it late would mean
          // supporting a "user exists but owns nothing" state everywhere.
          //
          // Failure is logged rather than thrown: rejecting here would fail the
          // signup for a user whose row is already committed. `getOrgContext()`
          // repairs the gap on the next request instead.
          if ((created as any).id) {
            try {
              await ensurePersonalOrganization({
                id: (created as any).id as string,
                email,
                nickname: name,
              });
            } catch (e) {
              logger.error(
                {
                  err: e,
                  event: "auth.personal_org_create_failed",
                  user_id: (created as any).id,
                },
                "failed to create personal organization"
              );
            }
          }

          // Queued rather than sent inline: work not awaited by the response
          // can be dropped when a serverless instance freezes, and the job
          // table gives us retries and a record of the outcome.
          if (email) {
            await enqueueJobSafe(
              "welcome_email",
              { email, name, userUuid },
              { dedupeKey: `welcome_email:${userUuid ?? email}` }
            );
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          // The sign-in gate.
          //
          // A session row is what "signed in" means, and every route in — email
          // and password, Google, a completed second factor — ends by creating
          // one. Checking here instead of on the sign-in endpoints is the
          // difference between banned and banned-from-some-of-the-doors.
          //
          // The other half is `deleteSessionsByUserId()`, which the ban runs
          // immediately: this stops the next sign-in, that ends the current one.
          const userId = (session as { userId?: string }).userId;
          if (!userId) return;

          if (await isUserIdBanned(userId)) {
            const info = describeAuthRequest(context);
            logger.warn(
              {
                event: "auth.signin_blocked_banned",
                user_id: userId,
                provider: info.provider,
                ip: info.ip,
              },
              "sign-in rejected: account suspended"
            );

            throw new APIError("FORBIDDEN", {
              code: "ACCOUNT_SUSPENDED",
              message: "ACCOUNT_SUSPENDED",
            });
          }
        },
        after: async (session, context) => {
          // Fires once per sign-in, including OAuth. This is what makes
          // sign-in frequency answerable — session rows are deleted on
          // sign-out and expiry, so they cannot serve as a log.
          const info = describeAuthRequest(context);
          const userId = (session as any).userId as string | undefined;
          if (!userId) return;

          const user = await findUserById(userId).catch(() => undefined);
          if (!user) return;

          await Promise.all([
            recordAuthEvent({
              event: "signin",
              userUuid: user.uuid,
              userId,
              email: user.email ?? "",
              info: {
                ...info,
                // The session row already carries what Better Auth resolved.
                ip: ((session as any).ipAddress as string) || info.ip,
                userAgent:
                  ((session as any).userAgent as string) || info.userAgent,
              },
            }),
            touchLastSignin(user.uuid),
          ]);
        },
      },
    },
  },
});

export function isAuthEnabled() {
  return getAppEnv().NEXT_PUBLIC_AUTH_ENABLED;
}
