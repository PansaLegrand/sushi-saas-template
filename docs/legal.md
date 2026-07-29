# Legal pages and cookie consent

This kit ships a privacy policy, terms of service, and a consent gate for
third-party scripts. **The documents are a drafting skeleton, not legal advice
and not a finished policy.** They exist so you have the right structure and the
right sections, populated from what this codebase actually does — not so you can
launch without reading them.

Two things are needed before launch: fill in `src/config/legal.ts`, and have a
lawyer review both documents.

## What ships

| Surface | Where |
| --- | --- |
| Privacy policy | `/[locale]/privacy` |
| Terms of service | `/[locale]/terms` |
| Document text and entity details | `src/config/legal.ts` |
| Consent rules | `src/lib/consent.ts` |
| Consent state for the UI | `src/providers/consent.tsx` |
| Banner | `src/components/legal/cookie-banner.tsx` |
| Footer links and cookie settings | `src/components/site-footer.tsx` |
| Which vendors are configured | `src/config/analytics.ts` |

Both pages remain public in the SaaS application because payment processors and
customers expect to find the governing policy beside signup and checkout. The
detached marketing site may link to the same reviewed policy.

## Before you launch

1. **Fill in `src/config/legal.ts`.** Registered entity name, registered
   address, a privacy contact address, a legal contact address, and governing
   law. Until all five are set, `LegalConfig.isConfigured` is false and every
   legal page renders a visible unreviewed-draft notice. That notice is not
   dismissible on purpose.

2. **Work through the bracketed placeholders.** Each `[LIKE THIS]` marks a
   decision the kit cannot make for you: the international transfer mechanism,
   your refund policy, your liability cap, the minimum age, and the retention
   table.

3. **Reconcile the retention section with reality.** The privacy policy states
   how long data is kept. That has to match what your deletion implementation
   actually does — see the account-deletion item in [roadmap.md](../roadmap.md).
   A retention promise you do not keep is worse than no promise.

4. **Check the sub-processor list.** `LegalData.subProcessors` defaults to the
   providers this kit integrates with. Delete what you do not enable and add
   what you do. This list is the part regulators check first.

5. **Have a lawyer review both documents.** What you must disclose depends on
   where you and your users are, what you collect, and who you sell to.

## How consent works

The rule is deny by default. `parseConsentCookie` returns `null` for an absent,
malformed, or outdated decision, and `isAllowed(null, ...)` is always false.
"Has not decided" and "said no" behave identically at the point a script would
load; the only difference is whether the banner is still asking.

Scripts gate themselves. `GoogleAnalytics` and `Adsense` both call `useConsent()`
and return `null` until the visitor opts in — the banner is only the UI for the
decision, never the thing enforcing it. Gating the tag rather than setting a flag
inside it is deliberate: a loaded tag has already set cookies and already
contacted the vendor, which is the part consent law is about.

`tests/unit/architecture.test.ts` fails the build if a file references a known
tracker host without calling `useConsent()`, so a new provider added later is
caught the same way.

### Adding a vendor

1. Add its detection to `src/config/analytics.ts`.
2. Gate its component on `useConsent().allows("analytics" | "advertising")`.
3. Add it to `LegalData.subProcessors` if it receives personal data.
4. Bump `CONSENT_VERSION` in `src/lib/consent.ts` if you added it to a category
   people have already consented to. Stored decisions are then discarded and
   visitors are asked again, because they never agreed to the new thing.

### No vendors configured

With neither `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` nor `NEXT_PUBLIC_GOOGLE_ADCODE`
set, `hasConsentGatedScripts()` is false: no banner, and no cookie settings
control in the footer. A fresh clone has nothing to consent to, and a banner
asking permission for cookies that do not exist teaches people to click through
without reading.

## Changing the documents

Bump `LegalData.effectiveDate` whenever either document changes materially, and
tell existing users before the new version takes effect.

The documents deliberately live in one language rather than in
`messages/*.json`. A machine-translated policy is one nobody has read, and a
translated legal document can carry different legal effect from its source. The
page chrome — headings, the banner, the draft notice — is translated normally.
Localise the documents themselves only with counsel who works in that language.
