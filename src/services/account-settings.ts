import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { hasPasswordCredential, listAccountProviders } from "@/models/account";
import { listActiveAccountSessions } from "@/models/session";
import { findUserById } from "@/models/user";
import { describeAuthRequest, recordAuthEvent } from "@/services/auth-events";
import { requireFreshAccountSession, type AccountActor } from "@/services/account-lifecycle";
import type { AccountSettingsView, SessionRevocation } from "@/types/account";

function sessionReference(userUuid: string, sessionId: string): string {
  return createHash("sha256").update(`account-session:${userUuid}:${sessionId}`).digest("hex");
}

export async function getAccountSettings(actor: AccountActor): Promise<AccountSettingsView> {
  const [user, hasPassword, providers, sessions] = await Promise.all([
    findUserById(actor.userId), hasPasswordCredential(actor.userId),
    listAccountProviders(actor.userId), listActiveAccountSessions(actor.userId),
  ]);
  if (!user) throw new AppError("ACCOUNT_NOT_FOUND");
  return {
    userUuid: user.uuid, name: user.nickname, email: user.email,
    emailVerified: user.email_verified, hasPassword, providers,
    twoFactorEnabled: user.two_factor_enabled,
    mfaRequired: user.role === "admin_ro" || user.role === "admin_rw",
    sessions: sessions.map((session) => ({
      reference: sessionReference(user.uuid, session.id), current: session.id === actor.sessionId,
      createdAt: session.created_at.toISOString(), expiresAt: session.expires_at.toISOString(),
      userAgent: session.user_agent?.slice(0, 200) ?? null,
    })),
  };
}

export async function updateAccountName(actor: AccountActor, headers: Headers, name: string): Promise<AccountSettingsView> {
  if (actor.lifecycleStatus === "erasing") throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  const normalized = name.trim();
  if (!normalized || normalized.length > 100) throw new AppError("REQUEST_INVALID");
  await auth.api.updateUser({ headers, body: { name: normalized } });
  await recordAuthEvent({ event: "profile_updated", userUuid: actor.userUuid, userId: actor.userId,
    info: describeAuthRequest({ headers, path: "/api/account/profile" }), metadata: { fields: ["name"] } });
  return getAccountSettings(actor);
}

export async function revokeAccountSessions(actor: AccountActor, headers: Headers, action: SessionRevocation): Promise<AccountSettingsView> {
  requireFreshAccountSession(actor);
  if (!actor.sessionId) throw new AppError("AUTH_REQUIRED");
  if (actor.lifecycleStatus === "erasing") throw new AppError("ACCOUNT_DELETION_IN_PROGRESS");
  let changed = false;
  if (action.scope === "others") {
    const sessions = await listActiveAccountSessions(actor.userId);
    if (sessions.some((session) => session.id !== actor.sessionId)) {
      await auth.api.revokeOtherSessions({ headers });
      changed = true;
    }
  } else {
    const sessions = await listActiveAccountSessions(actor.userId);
    const target = sessions.find((session) => sessionReference(actor.userUuid, session.id) === action.reference);
    if (target?.id === actor.sessionId) throw new AppError("REQUEST_INVALID", { message: "use sign-out for the current session" });
    // Unknown/already revoked references are a no-op, never an unscoped lookup.
    if (target) { await auth.api.revokeSession({ headers, body: { token: target.token } }); changed = true; }
  }
  if (changed) await recordAuthEvent({ event: "sessions_revoked", userUuid: actor.userUuid, userId: actor.userId,
    info: describeAuthRequest({ headers, path: "/api/account/sessions" }), metadata: { scope: action.scope } });
  return getAccountSettings(actor);
}
