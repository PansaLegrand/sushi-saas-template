"use client";

import { createAuthClient } from "better-auth/react";

export const adminAuthClient = createAuthClient({});

export const { signIn, signOut, useSession } = adminAuthClient;
