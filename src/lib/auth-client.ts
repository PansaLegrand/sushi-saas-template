"use client";

import { createAuthClient } from "better-auth/react";

const baseURL = process.env.NEXT_PUBLIC_AUTH_BASE_URL;

export const authClient = createAuthClient({
  baseURL: baseURL && baseURL.length > 0 ? baseURL : undefined,
});

export const { signIn, signOut, signUp, useSession } = authClient;
