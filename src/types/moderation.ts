/**
 * The vocabulary of account moderation.
 *
 * Types only, so the admin console can talk about a suspension without pulling
 * the service — and its database driver — into the browser bundle.
 */

/** Which key a blocklist row matches on. */
export type BlocklistScope = "email" | "domain";

/** A blocklist rule, as the admin console sees it. */
export interface BlocklistEntry {
  uuid: string;
  scope: BlocklistScope;
  /** The normalized match key. Not a deliverable address — see `src/lib/email-address.ts`. */
  value: string;
  /** What the admin actually typed, kept so the entry is recognizable. */
  originalValue: string;
  reason: string | null;
  createdBy: string;
  /** Null means permanent. */
  expiresAt: string | null;
  createdAt: string;
}

/** One account's suspension state. */
export interface BanState {
  userUuid: string;
  email: string;
  banned: boolean;
  bannedAt: string | null;
  reason: string | null;
  /** `users.uuid` of the admin who banned, or "" for a system ban. */
  bannedBy: string;
  /** Live sessions right now. Non-zero on a banned account means the ban did not revoke. */
  activeSessions: number;
}

/**
 * What a suspension actually did.
 *
 * `alsoBanned` is the part worth reading: one address can hold several accounts
 * — a password signup and a Google one are separate rows — and a ban that
 * closed only the row the admin pasted is a ban the user walks around by
 * clicking the other sign-in button.
 */
export interface BanResult {
  userUuid: string;
  email: string;
  /** False when the account was already suspended; the original ban is left intact. */
  applied: boolean;
  /** Sibling accounts on the same address that were suspended alongside it. */
  alsoBanned: string[];
  /** Sessions killed across every affected account. */
  sessionsRevoked: number;
  /** The blocklist rule added, if the admin asked for one. */
  blocklisted: BlocklistEntry | null;
  state: BanState;
}

export interface UnbanResult {
  userUuid: string;
  /** False when the account was not suspended to begin with. */
  applied: boolean;
  /** Sibling accounts on the same address that were restored alongside it. */
  alsoUnbanned: string[];
  /**
   * Blocklist rules matching this address that are still live.
   *
   * Lifting a ban does not lift them: the rule may predate this account or
   * cover a whole domain, so removing it is a separate, deliberate call. An
   * unbanned account whose address is still blocked can sign in but cannot
   * re-register, and an admin who cannot see that spends the afternoon puzzled.
   */
  remainingBlocklistEntries: BlocklistEntry[];
  state: BanState;
}
