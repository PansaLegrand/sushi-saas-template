import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createFieldAttribute } from "better-auth/db";

import { randomUUID } from "node:crypto";

import { db } from "@/db";
import * as schema from "@/db/schema";

const database = db();

export const auth = betterAuth({
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Sushi SaaS",
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(database, {
    schema,
    provider: "pg",
  }),
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
  },
  plugins: [nextCookies()],
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
  return process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";
}
