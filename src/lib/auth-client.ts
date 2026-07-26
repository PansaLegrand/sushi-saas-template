"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

const baseURL = process.env.NEXT_PUBLIC_AUTH_BASE_URL;

export const authClient = createAuthClient({
  baseURL: baseURL && baseURL.length > 0 ? baseURL : undefined,
  plugins: [twoFactorClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
