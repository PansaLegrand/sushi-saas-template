import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findUserByEmail, findUserByUuid } from "@/models/user";
import { respForbidden, respNoAuth } from "@/lib/resp";

export const ADMIN_RO = "admin_ro";
export const ADMIN_RW = "admin_rw";
export type AdminRole = typeof ADMIN_RO | typeof ADMIN_RW;
export type UserRole = "user" | AdminRole;

export interface AdminContext {
  userId: string;
  userUuid: string;
  email: string;
  role: AdminRole;
}

function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === ADMIN_RO || role === ADMIN_RW;
}

async function getSessionUser() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export async function getAdminContext(): Promise<AdminContext | null> {
  const result = await getSessionUser();
  if (!result) return null;

  const { user } = result;
  const email = (user.email as string) || "";
  const userId = user.id as string;
  let userUuid = ((user as any).uuid as string | undefined) ?? "";

  let dbUser = userUuid ? await findUserByUuid(userUuid) : undefined;
  if (!dbUser && email) {
    dbUser = await findUserByEmail(email);
  }

  if (!dbUser || !isAdminRole(dbUser.role)) {
    return null;
  }

  return {
    userId,
    userUuid: dbUser.uuid,
    email: dbUser.email ?? email,
    role: dbUser.role,
  };
}

export async function requireAdminRead(): Promise<AdminContext | Response> {
  const ctx = await getAdminContext();
  if (!ctx) return respNoAuth();
  return ctx;
}

export async function requireAdminWrite(): Promise<AdminContext | Response> {
  const ctx = await getAdminContext();
  if (!ctx) return respNoAuth();
  if (ctx.role === ADMIN_RW) return ctx;
  return respForbidden();
}
