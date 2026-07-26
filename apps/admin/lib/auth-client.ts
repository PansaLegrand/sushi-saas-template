"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const adminAuthClient = createAuthClient({
  plugins: [twoFactorClient()],
});

export const { signIn, signOut, useSession } = adminAuthClient;
