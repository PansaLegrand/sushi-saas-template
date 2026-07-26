import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { findUserById, findUserByUuid } from "@/models/user";
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
  mfaEnabled: boolean;
}

type AdminResolution =
  | { status: "authorized"; context: AdminContext }
  | { status: "mfa-required"; identity: AdminContext }
  | { status: "unauthorized" };

function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === ADMIN_RO || role === ADMIN_RW;
}

async function getSessionUser() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

async function resolveAdmin(): Promise<AdminResolution> {
  const result = await getSessionUser();
  if (!result) return { status: "unauthorized" };

  const { user } = result;
  const email = (user.email as string) || "";
  const userId = user.id as string;
  const userUuid = ((user as any).uuid as string | undefined) ?? "";

  // Resolve the role strictly from identifiers that uniquely identify one row.
  // `users.email` is only unique per signin_provider, so an email lookup can
  // resolve a different account than the session's — never key authz on it.
  const dbUser = userUuid
    ? await findUserByUuid(userUuid)
    : userId
      ? await findUserById(userId)
      : undefined;

  if (!dbUser || !isAdminRole(dbUser.role)) {
    return { status: "unauthorized" };
  }

  // Fail closed if the row we loaded is not the session's own account.
  if (userId && dbUser.id !== userId) {
    return { status: "unauthorized" };
  }

  const context = {
    userId,
    userUuid: dbUser.uuid,
    email: dbUser.email ?? email,
    role: dbUser.role,
    mfaEnabled: Boolean((dbUser as any).two_factor_enabled),
  };

  if (!context.mfaEnabled) {
    return { status: "mfa-required", identity: context };
  }

  return { status: "authorized", context };
}

export async function getAdminIdentity(): Promise<AdminContext | null> {
  const resolution = await resolveAdmin();
  if (resolution.status === "authorized") return resolution.context;
  if (resolution.status === "mfa-required") return resolution.identity;
  return null;
}

export async function getAdminContext(): Promise<AdminContext | null> {
  const resolution = await resolveAdmin();
  return resolution.status === "authorized" ? resolution.context : null;
}

export async function requireAdminRead(): Promise<AdminContext | Response> {
  const resolution = await resolveAdmin();
  if (resolution.status === "authorized") return resolution.context;
  if (resolution.status === "mfa-required") return respForbidden();
  return respNoAuth();
}

export async function requireAdminWrite(): Promise<AdminContext | Response> {
  const resolution = await resolveAdmin();
  if (resolution.status === "mfa-required") return respForbidden();
  if (resolution.status !== "authorized") return respNoAuth();
  const ctx = resolution.context;
  if (ctx.role === ADMIN_RW) return ctx;
  return respForbidden();
}
