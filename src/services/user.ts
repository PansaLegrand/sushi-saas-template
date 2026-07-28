import { auth } from "@/lib/auth";
import {
  hasPasswordCredential,
  listAccountProviders,
} from "@/models/account";
import { findUserById, findUserByUuid } from "@/models/user";
import type { CreditSummary } from "@/types/credit";
import type { UserProfile } from "@/types/user";

import { getOrgContext } from "./authz";
import { getOrgCreditSummary } from "./credit";

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

/**
 * Whether the signed-in account can be asked for a password.
 *
 * An account created through Google has no password, so the two-factor setup
 * form's "confirm your password" prompt is unanswerable — every input fails.
 * The page reads this so it can offer to *set* one instead of demanding one.
 */
export async function getPasswordCredentialState(
  requestHeaders: Headers
): Promise<{ userId: string; hasPassword: boolean; providers: string[] } | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const userId = (session.user as BetterAuthUser).id;

  const [hasPassword, providers] = await Promise.all([
    hasPasswordCredential(userId),
    listAccountProviders(userId),
  ]);

  return { userId, hasPassword, providers };
}

export type SetPasswordOutcome =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "already-set" };

/**
 * Give a provider-only account its first password.
 *
 * Delegates to Better Auth's `setPassword`, which is deliberately server-side:
 * it is not on the auth client, so there is no browser-reachable endpoint for
 * it until an app adds one. It creates the `credential` account when none
 * exists and **refuses when one already does** — changing a known password is
 * `changePassword`, which re-authenticates, and routing both through one
 * endpoint would let a hijacked session silently rotate a real password.
 *
 * The session-freshness requirement is Better Auth's own (`sensitiveSessionMiddleware`)
 * and stands in for the re-authentication that an account with no password
 * cannot perform.
 */
export async function setInitialPassword(
  requestHeaders: Headers,
  newPassword: string
): Promise<SetPasswordOutcome> {
  const state = await getPasswordCredentialState(requestHeaders);
  if (!state) return { status: "unauthenticated" };

  // Checked here as well as inside Better Auth so the caller gets a typed
  // outcome rather than having to pattern-match on an error message.
  if (state.hasPassword) return { status: "already-set" };

  await auth.api.setPassword({
    body: { newPassword },
    headers: requestHeaders,
  });

  return { status: "ok" };
}

export async function getUserProfile(
  req: Request,
  options: CreditOptions = {}
): Promise<UserProfile | null> {
  // The profile carries a credit balance, and a balance belongs to an
  // organization rather than to a person, so the profile needs both identities.
  const ctx = await getOrgContext(req);
  if (!ctx) {
    return null;
  }

  return getUserProfileByUuid(ctx.userUuid, ctx.orgUuid, options);
}

export async function getUserProfileByUuid(
  userUuid: string,
  orgUuid: string,
  options: CreditOptions = {}
): Promise<UserProfile | null> {
  const dbUser = await findUserByUuid(userUuid);
  if (!dbUser) {
    return null;
  }

  const credits: CreditSummary = await getOrgCreditSummary(orgUuid, {
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
