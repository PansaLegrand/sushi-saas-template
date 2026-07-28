/**
 * Email address normalization, for matching rather than for delivery.
 *
 * The problem this solves: `a.b+1@…`, `ab+2@…`, and `A.B@…` are one mailbox at
 * some providers and three different strings everywhere else. A blocklist that
 * compares raw input blocks exactly one of them, which is no block at all —
 * cycling the suffix is the first thing an abuser tries, and it costs them one
 * keystroke.
 *
 * **Never store or send a normalized address.** It is a lookup key, not a
 * mailbox: the normalized form of a real address may not deliver.
 */

/** Gmail is the reason the dot rule exists; both of its domains map to one. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const GMAIL_CANONICAL_DOMAIN = "gmail.com";

export interface ParsedEmail {
  local: string;
  domain: string;
}

/**
 * Split at the last `@`.
 *
 * The last rather than the first: a quoted local part may legally contain one,
 * and the domain never can. Returns null for anything without both halves,
 * which is the caller's signal to reject rather than to guess.
 */
export function parseEmail(input: string | null | undefined): ParsedEmail | null {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (!trimmed) return null;

  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // A domain with no dot is not a public address; treating `foo@localhost` as
  // blockable would let one entry match a whole class of internal addresses.
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }

  return { local, domain };
}

/**
 * The blocklist match key for an address.
 *
 * Three rules, in descending order of how safe they are:
 *
 * 1. **Lowercase.** Domains are case-insensitive by spec, and no provider in
 *    practice treats two case variants of a local part as two mailboxes.
 *
 * 2. **Strip `+suffix` from the local part.** Supported by Gmail, Outlook,
 *    iCloud, Proton, and Fastmail — which covers approximately everyone who
 *    signs up for anything. The tradeoff is real and deliberate: at a provider
 *    that treats `+` as an ordinary character, blocking `ann+test@corp.example`
 *    also blocks `ann@corp.example`, who may be someone else. Accepted because
 *    the alternative — an alias cycle that defeats the blocklist entirely — is
 *    the attack this exists to stop, and because an admin can see the entry and
 *    delete it. Over-blocking here is visible and reversible; under-blocking is
 *    neither.
 *
 * 3. **Strip dots from the local part — Gmail only.** Deliberately not applied
 *    everywhere. Dots are significant at most providers, so a global rule would
 *    collapse genuinely different mailboxes onto one key and block strangers.
 *
 * Returns null when the input is not a parseable address.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  const parsed = parseEmail(input);
  if (!parsed) return null;

  let { local } = parsed;
  let { domain } = parsed;

  // Whitespace only reaches here from a paste, and a key built from it can
  // never match a real signup — reject rather than store an entry that looks
  // active in the console and blocks nobody.
  if (/\s/.test(local)) return null;

  const plus = local.indexOf("+");
  // `+tag@…` is all suffix and no mailbox. Stripping it would leave an empty
  // key, and an empty key is a blocklist row that matches every address.
  if (plus === 0) return null;
  if (plus > 0) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = GMAIL_CANONICAL_DOMAIN;
  }

  // Reachable from an all-dots local part at Gmail.
  if (!local) return null;

  return `${local}@${domain}`;
}

/**
 * The blocklist match key for a whole domain.
 *
 * Accepts either a bare host or a full address, because an admin pasting from a
 * signup log has whichever one was in front of them. Gmail's alias domain is
 * canonicalized here too, so blocking one form blocks both.
 */
export function normalizeEmailDomain(
  input: string | null | undefined
): string | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;

  const host = raw.includes("@") ? (parseEmail(raw)?.domain ?? null) : raw;
  if (!host) return null;

  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    return null;
  }

  // Rejects whitespace, a stray path, and the `@` of a half-pasted address.
  if (!/^[a-z0-9.-]+$/.test(host)) return null;

  return GMAIL_DOMAINS.has(host) ? GMAIL_CANONICAL_DOMAIN : host;
}
