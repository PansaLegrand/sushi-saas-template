import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger/server";
import { normalizeEmail, normalizeEmailDomain } from "@/lib/email-address";
import {
  countBlocklistEntries,
  deleteBlocklistEntryByUuid,
  findActiveBlocklistMatches,
  findBlocklistEntry,
  insertBlocklistEntry,
  listBlocklistEntries,
  type BlocklistSearch,
  type EmailBlocklistRow,
} from "@/models/email-blocklist";
import { countSessionsByUserId, deleteSessionsByUserId } from "@/models/session";
import {
  findUserById,
  findUserByUuid,
  findUsersByEmail,
  markUserBanned,
  markUserUnbanned,
} from "@/models/user";
import type {
  BanResult,
  BanState,
  BlocklistEntry,
  BlocklistScope,
  UnbanResult,
} from "@/types/moderation";

/**
 * Suspending accounts, and keeping the address they used out.
 *
 * ## Why this is not a delete
 *
 * The instinct during an abuse wave is to delete the account. Deleting is the
 * one thing that helps the attacker: it frees the address to register again,
 * and it destroys the signup IP, the timestamps, and the pattern you need to
 * recognize the next hundred. A ban keeps the row *as the block* and keeps the
 * evidence with it. Erasure is a different operation with a different trigger —
 * a person asking for their data back — and it is not implemented here.
 *
 * ## Why one ban touches several rows
 *
 * `users.email` is unique per `signin_provider`, so one address can hold more
 * than one account. Banning the row an abuser happened to use leaves the others
 * open, and the bypass is one click on a different sign-in button. Every
 * function here works on the address, not just the row it was handed.
 *
 * ## What a ban deliberately does not do
 *
 * It does not touch credits, orders, files, or organizations. Those are
 * financial records, evidence, and shared tenant state — a suspension that
 * silently emptied a workspace could not be lifted, and lifting it is the whole
 * reason a ban is not a delete.
 */

const BAN_REASON_MAX = 500;

/** Postgres unique violation, surfaced directly or wrapped by the driver. */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "23505") return true;

  const cause = (e as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "23505";
}

function truncate(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function toBlocklistEntry(row: EmailBlocklistRow): BlocklistEntry {
  return {
    uuid: row.uuid,
    scope: row.scope as BlocklistScope,
    value: row.value,
    originalValue: row.original_value,
    reason: row.reason,
    createdBy: row.created_by,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The signup gate
// ---------------------------------------------------------------------------

export type SignupBlockReason = "email" | "domain";

export interface SignupCheck {
  allowed: boolean;
  reason?: SignupBlockReason;
  /** The rule that matched, for the log. Never returned to the browser. */
  matchedValue?: string;
}

/**
 * May this address create an account?
 *
 * Called from the Better Auth `user.create.before` hook, which covers every
 * signup path — email/password *and* OAuth. That matters more than it looks:
 * OAuth signup has no captcha in front of it, so if this check lived on the
 * credential endpoint alone, "sign in with Google" would be an open door.
 *
 * **Fails open.** A database error here allows the signup and logs at error
 * level. This is an abuse filter, not an authentication check — nothing about
 * the app's integrity rests on it, and the failure it would otherwise cause is
 * total: a missing migration or a brief outage would stop every legitimate
 * signup in the product. Degrading abuse protection beats degrading the front
 * door. The ban check below fails open for the same reason.
 */
export async function checkSignupAllowed(
  email: string | null | undefined
): Promise<SignupCheck> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedDomain = normalizeEmailDomain(email);

  if (!normalizedEmail && !normalizedDomain) return { allowed: true };

  try {
    const matches = await findActiveBlocklistMatches({
      normalizedEmail,
      normalizedDomain,
    });

    // Prefer the domain rule when both apply: it is the broader fact, and the
    // one an operator reading the log wants to know fired.
    const match = matches.find((row) => row.scope === "domain") ?? matches[0];
    if (!match) return { allowed: true };

    return {
      allowed: false,
      reason: match.scope === "domain" ? "domain" : "email",
      matchedValue: match.value,
    };
  } catch (e) {
    logger.error(
      { err: e, event: "moderation.signup_check_failed" },
      "signup blocklist check failed; allowing signup"
    );
    return { allowed: true };
  }
}

/**
 * Is this account suspended?
 *
 * Called from the Better Auth `session.create.before` hook, which is the one
 * chokepoint every sign-in passes through — password, OAuth, and the
 * second factor alike. Blocking here rather than on a specific endpoint is what
 * makes "banned" mean banned instead of "banned from one of the four ways in".
 *
 * Fails open, for the reason stated on `checkSignupAllowed`.
 */
export async function isUserIdBanned(userId: string): Promise<boolean> {
  try {
    const user = await findUserById(userId);
    return Boolean(user?.banned_at);
  } catch (e) {
    logger.error(
      { err: e, event: "moderation.ban_check_failed", user_id: userId },
      "ban check failed; allowing sign-in"
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------------

export async function getBanState(userUuid: string): Promise<BanState | null> {
  const user = await findUserByUuid(userUuid);
  if (!user) return null;

  return {
    userUuid: user.uuid,
    email: user.email,
    banned: Boolean(user.banned_at),
    bannedAt: user.banned_at?.toISOString() ?? null,
    reason: user.ban_reason,
    bannedBy: user.banned_by,
    activeSessions: await countSessionsByUserId(user.id),
  };
}

// ---------------------------------------------------------------------------
// Banning
// ---------------------------------------------------------------------------

export interface BanUserInput {
  userUuid: string;
  reason?: string | null;
  /** `users.uuid` of the admin. Empty string for a system ban. */
  actorUuid: string;
  /**
   * Also block the address from registering again.
   *
   * Defaults on, and should stay on for abuse. Without it the ban closes the
   * accounts that exist and nothing else: the same person clicks "sign in with
   * Google", Better Auth creates a *new* user row for that provider, and the
   * new row is not banned. The blocklist is the only part of this that stops a
   * re-registration.
   */
  blockEmail?: boolean;
}

export type BanOutcome =
  | { status: "not-found" }
  | { status: "ok"; result: BanResult };

export async function banUserAccount(
  input: BanUserInput
): Promise<BanOutcome> {
  const target = await findUserByUuid(input.userUuid);
  if (!target) return { status: "not-found" };

  const reason = truncate(input.reason, BAN_REASON_MAX);
  const blockEmail = input.blockEmail ?? true;

  // Every row on this address, not just the one we were handed.
  const siblings = target.email ? await findUsersByEmail(target.email) : [];
  const accounts = siblings.some((row) => row.uuid === target.uuid)
    ? siblings
    : [target, ...siblings];

  let applied = false;
  const alsoBanned: string[] = [];
  let sessionsRevoked = 0;

  for (const account of accounts) {
    const banned = await markUserBanned({
      user_uuid: account.uuid,
      reason,
      banned_by: input.actorUuid,
    });

    // Undefined means it was already banned. Still revoke its sessions: an
    // account banned an hour ago that somehow holds a live session is exactly
    // the case a second ban is being used to fix.
    if (banned) {
      if (account.uuid === target.uuid) applied = true;
      else alsoBanned.push(account.uuid);
    }

    sessionsRevoked += await deleteSessionsByUserId(account.id);
  }

  let blocklisted: BlocklistEntry | null = null;
  if (blockEmail && target.email) {
    blocklisted = await addBlocklistEntry({
      scope: "email",
      value: target.email,
      reason: reason ?? `Banned account ${target.uuid}`,
      actorUuid: input.actorUuid,
    }).then((outcome) => (outcome.status === "invalid" ? null : outcome.entry));
  }

  logger.warn(
    {
      event: "moderation.user_banned",
      user_uuid: target.uuid,
      actor_uuid: input.actorUuid,
      accounts_affected: accounts.length,
      sessions_revoked: sessionsRevoked,
      blocklisted: Boolean(blocklisted),
      already_banned: !applied,
    },
    "account suspended"
  );

  const state = await getBanState(target.uuid);

  return {
    status: "ok",
    result: {
      userUuid: target.uuid,
      email: target.email,
      applied,
      alsoBanned,
      sessionsRevoked,
      blocklisted,
      state: state ?? {
        userUuid: target.uuid,
        email: target.email,
        banned: true,
        bannedAt: new Date().toISOString(),
        reason,
        bannedBy: input.actorUuid,
        activeSessions: 0,
      },
    },
  };
}

export type UnbanOutcome =
  | { status: "not-found" }
  | { status: "ok"; result: UnbanResult };

export async function unbanUserAccount(input: {
  userUuid: string;
  /** Lift the address block too. Off by default — see `remainingBlocklistEntries`. */
  removeBlocklistEntry?: boolean;
}): Promise<UnbanOutcome> {
  const target = await findUserByUuid(input.userUuid);
  if (!target) return { status: "not-found" };

  const siblings = target.email ? await findUsersByEmail(target.email) : [];
  const accounts = siblings.some((row) => row.uuid === target.uuid)
    ? siblings
    : [target, ...siblings];

  let applied = false;
  const alsoUnbanned: string[] = [];

  for (const account of accounts) {
    const restored = await markUserUnbanned(account.uuid);
    if (!restored) continue;

    if (account.uuid === target.uuid) applied = true;
    else alsoUnbanned.push(account.uuid);
  }

  if (input.removeBlocklistEntry && target.email) {
    const normalized = normalizeEmail(target.email);
    if (normalized) {
      const existing = await findBlocklistEntry("email", normalized);
      if (existing) await deleteBlocklistEntryByUuid(existing.uuid);
    }
  }

  // Reported whether or not the caller asked to lift them, because an unbanned
  // account still covered by a domain rule cannot register again and the admin
  // needs to see that without going to look for it.
  const remaining = await findMatchingBlocklistEntries(target.email);

  logger.info(
    {
      event: "moderation.user_unbanned",
      user_uuid: target.uuid,
      accounts_affected: accounts.length,
      blocklist_entries_remaining: remaining.length,
    },
    "account suspension lifted"
  );

  const state = await getBanState(target.uuid);

  return {
    status: "ok",
    result: {
      userUuid: target.uuid,
      applied,
      alsoUnbanned,
      remainingBlocklistEntries: remaining,
      state: state ?? {
        userUuid: target.uuid,
        email: target.email,
        banned: false,
        bannedAt: null,
        reason: null,
        bannedBy: "",
        activeSessions: 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The blocklist
// ---------------------------------------------------------------------------

export type AddBlocklistOutcome =
  | { status: "invalid" }
  | { status: "added"; entry: BlocklistEntry }
  | { status: "exists"; entry: BlocklistEntry };

/**
 * Add a rule. Idempotent: re-blocking an address returns the existing row
 * rather than failing or stacking a duplicate, so a double-click during an
 * incident is not something anyone has to think about.
 */
export async function addBlocklistEntry(input: {
  scope: BlocklistScope;
  /** Raw input — an address or a host. Normalized here, once. */
  value: string;
  reason?: string | null;
  actorUuid: string;
  expiresAt?: Date | null;
}): Promise<AddBlocklistOutcome> {
  const normalized =
    input.scope === "domain"
      ? normalizeEmailDomain(input.value)
      : normalizeEmail(input.value);

  if (!normalized) return { status: "invalid" };

  const existing = await findBlocklistEntry(input.scope, normalized);
  if (existing) return { status: "exists", entry: toBlocklistEntry(existing) };

  let row: EmailBlocklistRow | undefined;
  try {
    row = await insertBlocklistEntry({
      uuid: newId(),
      scope: input.scope,
      value: normalized,
      original_value: input.value.trim().slice(0, 255),
      reason: truncate(input.reason, BAN_REASON_MAX),
      created_by: input.actorUuid,
      expires_at: input.expiresAt ?? null,
    });
  } catch (e) {
    // Lost the race to a concurrent identical add. The unique index did its
    // job; the rule the caller asked for exists, which is all they wanted.
    if (!isUniqueViolation(e)) throw e;

    const winner = await findBlocklistEntry(input.scope, normalized);
    if (winner) return { status: "exists", entry: toBlocklistEntry(winner) };
    throw e;
  }

  if (!row) return { status: "invalid" };

  logger.warn(
    {
      event: "moderation.blocklist_added",
      scope: input.scope,
      actor_uuid: input.actorUuid,
      expires_at: input.expiresAt?.toISOString() ?? null,
    },
    "signup blocklist entry added"
  );

  return { status: "added", entry: toBlocklistEntry(row) };
}

export async function removeBlocklistEntry(
  uuid: string
): Promise<BlocklistEntry | null> {
  const row = await deleteBlocklistEntryByUuid(uuid);
  if (!row) return null;

  logger.warn(
    { event: "moderation.blocklist_removed", scope: row.scope },
    "signup blocklist entry removed"
  );

  return toBlocklistEntry(row);
}

/**
 * Turn what an operator typed into something that can match a stored rule.
 *
 * The reason this is not a plain substring search: a rule is stored under its
 * normalized key. An admin who pastes `a.b+spam@gmail.com` straight out of a
 * signup log is looking for a row whose `value` reads `ab@gmail.com`, and a
 * substring search would find nothing and report the address as free to
 * register. "Not blocked" is the one wrong answer this box must never give.
 *
 * The domain key goes in alongside the address key, so pasting a full address
 * also surfaces a domain rule covering it — which blocks that address just as
 * effectively, and is the rule an operator would otherwise never think to
 * search for.
 */
function buildBlocklistSearch(query?: string): BlocklistSearch | undefined {
  const text = query?.trim();
  if (!text) return undefined;

  const keys = [normalizeEmail(text), normalizeEmailDomain(text)].filter(
    (key): key is string => Boolean(key)
  );

  return { text, keys };
}

export async function listBlocklist(
  page: number = 1,
  limit: number = 50,
  query?: string
): Promise<{ items: BlocklistEntry[]; total: number }> {
  const search = buildBlocklistSearch(query);

  const [rows, total] = await Promise.all([
    listBlocklistEntries(page, limit, search),
    countBlocklistEntries(search),
  ]);

  return { items: rows.map(toBlocklistEntry), total };
}

/** Every live rule that would stop this address from registering. */
export async function findMatchingBlocklistEntries(
  email: string | null | undefined
): Promise<BlocklistEntry[]> {
  const matches = await findActiveBlocklistMatches({
    normalizedEmail: normalizeEmail(email),
    normalizedDomain: normalizeEmailDomain(email),
  });

  return matches.map(toBlocklistEntry);
}
