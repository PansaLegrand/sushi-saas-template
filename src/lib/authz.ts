import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findUserByUuid, type UserRole, findUserByEmail } from "@/models/user";
import { respForbidden, respNoAuth } from "@/lib/resp";

export const ADMIN_RO: UserRole = "admin_ro";
export const ADMIN_RW: UserRole = "admin_rw";

// Roles are determined solely from DB state (users.role).

export interface AdminContext {
  userId: string; // Better Auth user id
  userUuid: string; // our uuid
  email: string;
  role: UserRole;
}

async function getSessionUser() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  return session;
}

export async function getAdminContext(): Promise<AdminContext | null> {
  const result = await getSessionUser();
  if (!result) return null;

  const { user } = result;
  const email = (user.email as string) || "";
  const id = user.id as string;
  const uuid = (user as any).uuid as string | undefined;
  const roleFromSession = (user as any).role as UserRole | undefined;

  let role: UserRole = roleFromSession ?? "user";
  let userUuid = uuid ?? "";

  if (!userUuid || role === "user") {
    // Load from DB to get uuid/role
    if (userUuid) {
      const dbUser = await findUserByUuid(userUuid);
      if (dbUser) {
        role = (dbUser.role as UserRole) ?? role;
      }
    }
  }

  if (!userUuid && email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) {
      userUuid = byEmail.uuid;
      if (role === "user") {
        role = (byEmail.role as UserRole) ?? role;
      }
    }
  }

  return {
    userId: id,
    userUuid: userUuid,
    email,
    role,
  };
}

export async function requireAdminRead(): Promise<AdminContext | Response> {
  const ctx = await getAdminContext();
  if (!ctx) return respNoAuth();
  if (ctx.role === ADMIN_RO || ctx.role === ADMIN_RW) return ctx;
  return respForbidden();
}

export async function requireAdminWrite(): Promise<AdminContext | Response> {
  const ctx = await getAdminContext();
  if (!ctx) return respNoAuth();
  if (ctx.role === ADMIN_RW) return ctx;
  return respForbidden();
}
