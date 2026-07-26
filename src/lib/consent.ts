/**
 * Cookie consent state.
 *
 * Kept as pure functions with no React and no browser globals at module scope,
 * so the rules below can be unit tested rather than asserted by clicking a
 * banner.
 *
 * The default is deny. Under GDPR, consent must be an affirmative act, so
 * "no stored choice" and "rejected" have to behave identically at the point
 * where a script would load — the only difference between them is whether the
 * banner is still asking. Anything that treats an absent cookie as permission
 * has, in practice, no consent gate at all.
 */

/**
 * Categories a visitor can decide about.
 *
 * Strictly necessary cookies (the session, the CSRF token, this consent record
 * itself) are deliberately absent: they carry no choice, and offering one that
 * does nothing is its own dark pattern.
 */
export type ConsentCategory = "analytics" | "advertising";

export type ConsentState = Record<ConsentCategory, boolean>;

export const CONSENT_CATEGORIES: ConsentCategory[] = ["analytics", "advertising"];

/**
 * Readable by client JavaScript by design — the scripts it gates are loaded in
 * the browser, so an httpOnly cookie could not gate them.
 */
export const CONSENT_COOKIE = "cookie_consent";

/**
 * Bump when the categories change or a new vendor is added to an existing
 * category. A stored decision from an older version is discarded and the
 * visitor is asked again, because they never agreed to the new thing.
 */
export const CONSENT_VERSION = 1;

/** Six months. Long enough not to nag, short enough to re-ask periodically. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

export const DENY_ALL: ConsentState = Object.freeze({
  analytics: false,
  advertising: false,
});

export const ALLOW_ALL: ConsentState = Object.freeze({
  analytics: true,
  advertising: true,
});

interface StoredConsent {
  v: number;
  analytics: boolean;
  advertising: boolean;
}

/**
 * Parse a stored decision.
 *
 * Returns null for anything not recognisable — absent, malformed, or written by
 * an older version. Null means "has not decided", which callers must treat as
 * denial while the banner asks again.
 */
export function parseConsentCookie(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const stored = parsed as Partial<StoredConsent>;
  if (stored.v !== CONSENT_VERSION) return null;
  if (typeof stored.analytics !== "boolean") return null;
  if (typeof stored.advertising !== "boolean") return null;

  return { analytics: stored.analytics, advertising: stored.advertising };
}

export function serializeConsent(state: ConsentState): string {
  const stored: StoredConsent = {
    v: CONSENT_VERSION,
    analytics: state.analytics,
    advertising: state.advertising,
  };
  return encodeURIComponent(JSON.stringify(stored));
}

/** Read the decision from `document.cookie`. Null on the server. */
export function readStoredConsent(): ConsentState | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));

  return parseConsentCookie(match?.slice(CONSENT_COOKIE.length + 1));
}

export function writeStoredConsent(state: ConsentState): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${CONSENT_COOKIE}=${serializeConsent(state)}` +
    `; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Whether a category may load right now.
 *
 * The single place the deny-by-default rule is expressed, so a caller cannot
 * accidentally spell it `consent?.analytics !== false`.
 */
export function isAllowed(
  state: ConsentState | null,
  category: ConsentCategory
): boolean {
  if (!state) return false;
  return state[category] === true;
}
