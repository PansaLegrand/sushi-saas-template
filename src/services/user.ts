import { auth } from "@/lib/auth";
import { findUserById, findUserByUuid } from "@/models/user";
import type { CreditSummary } from "@/types/credit";
import type { UserProfile } from "@/types/user";

import { getUserCreditSummary } from "./credit";

interface CreditOptions {
  includeLedger?: boolean;
  creditLedgerLimit?: number;
}

interface BetterAuthUser {
  id: string;
  email: string;
  uuid?: string;
}

export async function getUserUuid(req: Request): Promise<string | null> {
  return getUserUuidFromHeaders(req.headers);
}

/**
 * The same lookup, for Server Components.
 *
 * A page has `headers()`, not a `Request`. Without this, every page that needs
 * the current user's uuid re-implements the session read and the
 * id-to-uuid fallback below — and one of them eventually keys authorization off
 * the email instead.
 */
export async function getUserUuidFromHeaders(
  requestHeaders: Headers
): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session) {
    return null;
  }

  const betterAuthUser = session.user as BetterAuthUser;
  if (betterAuthUser.uuid) {
    return betterAuthUser.uuid;
  }

  // Better Auth's user id uniquely identifies the account. Email can be shared
  // across providers, so it must not be used as an authorization key.
  const dbUser = await findUserById(betterAuthUser.id);
  return dbUser?.uuid ?? null;
}

export async function getUserProfile(
  req: Request,
  options: CreditOptions = {}
): Promise<UserProfile | null> {
  const userUuid = await getUserUuid(req);
  if (!userUuid) {
    return null;
  }

  return getUserProfileByUuid(userUuid, options);
}

export async function getUserProfileByUuid(
  userUuid: string,
  options: CreditOptions = {}
): Promise<UserProfile | null> {
  const dbUser = await findUserByUuid(userUuid);
  if (!dbUser) {
    return null;
  }

  const credits: CreditSummary = await getUserCreditSummary(userUuid, {
    includeLedger: options.includeLedger,
    ledgerLimit: options.creditLedgerLimit,
  });

  return {
    id: dbUser.id,
    uuid: dbUser.uuid,
    email: dbUser.email,
    nickname: dbUser.nickname,
    avatarUrl: dbUser.avatar_url,
    locale: dbUser.locale,
    inviteCode: dbUser.invite_code,
    invitedBy: dbUser.invited_by,
    isAffiliate: dbUser.is_affiliate,
    emailVerified: dbUser.email_verified,
    signinType: dbUser.signin_type,
    signinProvider: dbUser.signin_provider,
    signinOpenid: dbUser.signin_openid,
    createdAt: dbUser.created_at?.toISOString() ?? new Date().toISOString(),
    updatedAt: dbUser.updated_at?.toISOString() ?? new Date().toISOString(),
    credits,
  };
}
