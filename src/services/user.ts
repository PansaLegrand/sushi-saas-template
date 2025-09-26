import { auth } from "@/lib/auth";
import { findUserByEmail, findUserByUuid } from "@/models/user";
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
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session) {
    return null;
  }

  const betterAuthUser = session.user as BetterAuthUser;
  if (betterAuthUser.uuid) {
    return betterAuthUser.uuid;
  }

  // Fallback: resolve the UUID via email if the session payload lacked the field.
  const dbUser = await findUserByEmail(betterAuthUser.email);
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
