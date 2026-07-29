const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Product/legal defaults for account export and erasure.
 *
 * They are intentionally ordinary TypeScript configuration, not hidden
 * environment switches. An adopter must review these values with counsel and
 * commit the policy they operate under. External effects still fail closed:
 * changing a duration can never make the worker claim a Stripe or storage
 * deletion happened when it did not.
 */
export const ACCOUNT_LIFECYCLE_POLICY = {
  /** Cancellation window before irreversible provider work starts. */
  erasureGracePeriodMs: 7 * DAY_MS,
  /** Private export artifacts are removed after this window. */
  exportRetentionMs: 7 * DAY_MS,
  /** Destructive requests require a session created within this window. */
  sensitiveSessionMaxAgeMs: 15 * 60 * 1000,
  /** Remove the customer after all of its subscriptions have been canceled. */
  deleteStripeCustomers: true,
  /**
   * Abuse-prevention entries can have a separate lawful retention basis.
   * Set false if the deployed product has no such policy.
   */
  retainSecurityBlocklistEntries: true,
  /** Short-lived URL returned by the authenticated export status route. */
  exportDownloadUrlSeconds: 5 * 60,
} as const;
