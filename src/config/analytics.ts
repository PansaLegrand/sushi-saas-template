/**
 * Which consent-gated third-party scripts this deployment actually has.
 *
 * One place to ask, so the banner, the scripts, and the privacy policy cannot
 * disagree about whether there is anything to consent to. A fresh clone has
 * neither variable set and therefore shows no banner — asking permission to set
 * cookies that do not exist is how people learn to dismiss these without
 * reading them.
 *
 * Each `process.env.NEXT_PUBLIC_*` is written out literally because Next inlines
 * these at build time by static substitution; a computed lookup would read as
 * undefined in the browser.
 */

export function hasAnalytics(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID);
}

export function hasAdvertising(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_ADCODE);
}

/**
 * True when at least one category has a vendor configured. Drives whether the
 * consent banner and the footer's cookie settings control render at all.
 */
export function hasConsentGatedScripts(): boolean {
  return hasAnalytics() || hasAdvertising();
}
