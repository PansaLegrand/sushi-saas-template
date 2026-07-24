import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { createFieldAttribute } from "better-auth/db";

import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { CAPTCHA_PROTECTED_ENDPOINTS } from "@/lib/captcha";
import { getAppEnv, isProductionRuntime } from "@/lib/env";
import { sendResetPasswordEmail, sendVerifyEmail } from "@/services/email/send";
import * as schema from "@/db/schema";

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
      console.warn(
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
      try {
        await sendResetPasswordEmail(user.email, url);
      } catch (e) {
        console.error("failed to send reset password email", e);
      }
    },
    onPasswordReset: async ({ user }, _request) => {
      console.log(`Password reset completed for ${user.email}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }, _request) => {
      try {
        await sendVerifyEmail(user.email, url);
      } catch (e) {
        console.error("failed to send verification email", e);
      }
    },
  },
  // Captcha first: its onRequest hook must reject before any handler runs.
  plugins: [...captchaPlugins, nextCookies()],
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
        before: async (data) => {
          return {
            data: {
              ...data,
              uuid: data.uuid ?? randomUUID(),
            },
          };
        },
        after: async (created) => {
          try {
            const email = (created as any).email as string | undefined;
            const name = (created as any).nickname as string | undefined;
            if (email) {
              queueMicrotask(() => {
                import("@/services/email/send").then((m) =>
                  m
                    .sendWelcomeEmail(email, name)
                    .catch((e) => console.error("welcome email failed", e))
                );
              });
            }
          } catch (e) {
            console.error("failed to dispatch welcome email", e);
          }
          // Do not block or modify result; just side-effect
        },
      },
    },
  },
});

export function isAuthEnabled() {
  return getAppEnv().NEXT_PUBLIC_AUTH_ENABLED;
}
