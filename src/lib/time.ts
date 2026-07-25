/**
 * Returns the ISO timestamp string for the provided date (defaults to `new Date()`).
 */
export function getIsoTimestr(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Midnight UTC on the first of the month containing `date`.
 *
 * Monthly quotas reset on this boundary rather than on each user's billing
 * anniversary. UTC, deliberately: a per-user timezone would make the same
 * quota reset at a different instant for every account, which is impossible to
 * reason about when a user asks why they were cut off.
 */
export function startOfUtcMonth(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
