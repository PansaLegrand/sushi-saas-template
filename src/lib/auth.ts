import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
  appName: process.env.NEXT_PUBLIC_APP_NAME || "Sushi SaaS",
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    cookie: {
      secure: process.env.NODE_ENV === "production",
    },
  },
  plugins: [nextCookies()],
  telemetry: {
    enabled: false,
  },
});

export function isAuthEnabled() {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";
}
