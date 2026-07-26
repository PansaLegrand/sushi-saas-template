/**
 * The legal island.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS A DRAFTING SKELETON, NOT LEGAL ADVICE, AND NOT A FINISHED POLICY.
 *
 * The documents below cover the sections a SaaS of this shape usually needs,
 * populated from what this codebase actually does — Stripe for payments, an
 * S3-compatible bucket for uploads, an email provider for transactional mail.
 * That makes them a useful starting point and nothing more. What your product
 * must disclose depends on where you and your users are, what you collect, and
 * who you sell to. Have a lawyer review both documents before launch.
 *
 * `LegalConfig.isConfigured` is false until you fill in the identity fields,
 * and every page renders a visible unreviewed-draft notice while it is.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Like `src/config/site.ts`, this is a file you edit rather than code you
 * change. Keeping the text here rather than in `messages/*.json` is deliberate:
 * a machine-translated policy is a policy nobody has read, and a translated
 * legal document can carry different legal effect from its source. Localise
 * these only with counsel who works in that language.
 */

export interface LegalSection {
  heading: string;
  /** Paragraphs. Rendered as prose, in order. */
  body: string[];
}

export interface LegalDocument {
  title: string;
  /** ISO date. Shown to the reader and used for change tracking. */
  effectiveDate: string;
  sections: LegalSection[];
}

export const LegalData = {
  /**
   * The entity that is party to the terms and the controller of personal data.
   * A trading name is not enough — this needs to be the registered name.
   */
  entityName: null as string | null,

  /** Registered address. Required in the EU/UK; shown in both documents. */
  entityAddress: null as string | null,

  /** Where privacy requests go. May be the same as the support address. */
  privacyContactEmail: null as string | null,

  /** Where legal notices go. */
  legalContactEmail: null as string | null,

  /**
   * Governing law and forum, e.g. "the laws of England and Wales". Get this
   * one from a lawyer: guessing it is how a dispute ends up somewhere you did
   * not expect to litigate.
   */
  governingLaw: null as string | null,

  /**
   * Bumped whenever either document changes materially. Existing users should
   * be told before a new version takes effect.
   */
  effectiveDate: "2026-01-01",

  /**
   * Sub-processors that receive personal data. Edit to match what you actually
   * enable — an inaccurate list is worse than a short one, and this list is
   * the part regulators check first.
   */
  subProcessors: [
    { name: "Stripe", purpose: "Payment processing and subscription billing" },
    { name: "Resend", purpose: "Transactional email delivery" },
    {
      name: "Object storage provider (S3, Cloudflare R2, or compatible)",
      purpose: "Storage of files you upload",
    },
    { name: "Vercel", purpose: "Application hosting and request logs" },
  ] as Array<{ name: string; purpose: string }>,
} as const;

function entity(): string {
  return LegalData.entityName ?? "[YOUR LEGAL ENTITY NAME]";
}

function privacyEmail(): string {
  return LegalData.privacyContactEmail ?? "[PRIVACY CONTACT EMAIL]";
}

function legalEmail(): string {
  return LegalData.legalContactEmail ?? "[LEGAL CONTACT EMAIL]";
}

function address(): string {
  return LegalData.entityAddress ?? "[REGISTERED ADDRESS]";
}

function law(): string {
  return LegalData.governingLaw ?? "[GOVERNING LAW AND FORUM]";
}

export function buildPrivacyPolicy(): LegalDocument {
  const processors = LegalData.subProcessors
    .map((p) => `${p.name} — ${p.purpose}`)
    .join("; ");

  return {
    title: "Privacy Policy",
    effectiveDate: LegalData.effectiveDate,
    sections: [
      {
        heading: "Who we are",
        body: [
          `${entity()}, of ${address()}, operates this service and is the controller of the personal data described below.`,
          `For any question about this policy or about your data, contact ${privacyEmail()}.`,
        ],
      },
      {
        heading: "What we collect",
        body: [
          "Account data: your email address, your name if you provide one, your authentication method, and — if you enable two-factor authentication — the fact that it is enabled. We never store your password in readable form.",
          "Organisation data: the workspaces you belong to, your role in each, and invitations you send or receive.",
          "Billing data: your subscription tier, plan history, orders, and credit ledger. Card details are handled by our payment processor and never reach our servers.",
          "Content: files you upload and any text you submit through product features. These are private to your organisation by default.",
          "Technical data: IP address, user agent, and authentication events such as sign-ins and password resets. We keep these to detect abuse and to answer 'was this me?'",
          "Cookies and similar technologies: see the cookies section below.",
        ],
      },
      {
        heading: "Why we process it, and on what basis",
        body: [
          "To provide the service you asked for, including authentication, storage, and any feature you use — performance of our contract with you.",
          "To take payment and keep financial records — performance of our contract, and compliance with a legal obligation for records we must retain.",
          "To keep the service secure and to investigate abuse — our legitimate interest in a service that is not being attacked.",
          "To send transactional email such as verification, password resets, and receipts — performance of our contract.",
          "For analytics or advertising, where enabled — your consent, which you may give or withdraw at any time.",
        ],
      },
      {
        heading: "Cookies and similar technologies",
        body: [
          "Strictly necessary cookies keep you signed in, protect forms against cross-site request forgery, and remember your cookie choice. These are required for the service to function and are set without consent.",
          "Analytics and advertising technologies, where enabled, are set only after you accept them. Nothing in those categories loads before you make a choice, and rejecting them is a single click with the same prominence as accepting.",
          "You can change your decision at any time from the cookie settings link in the site footer. Withdrawing consent stops future collection; it does not undo processing that already, lawfully, happened.",
        ],
      },
      {
        heading: "Who we share it with",
        body: [
          "We do not sell personal data.",
          `We use service providers who process data on our instructions: ${processors}.`,
          "We may disclose data where we are legally required to, or to establish or defend legal claims.",
        ],
      },
      {
        heading: "International transfers",
        body: [
          "Our providers may process data outside your country, including outside the EEA or the UK. Where that happens we rely on an approved transfer mechanism, such as the European Commission's standard contractual clauses.",
          "[Confirm with counsel which mechanism applies to your provider set and the regions you serve, and name it here.]",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "Account and organisation data: for as long as your account exists.",
          "Financial records, including orders and subscription history: retained after account closure for the period our tax and accounting obligations require.",
          "Authentication and administrative audit events: retained as a security record, and by design cannot be edited after the fact.",
          "Uploaded files: until you delete them, subject to a short grace period during which a deleted record is recoverable.",
          "[This table must match what your deletion implementation actually does. Reconcile it with the account-deletion policy before publishing.]",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Depending on where you live, you may have the right to access your data, correct it, delete it, receive a portable copy, object to processing based on legitimate interests, or withdraw consent you have given.",
          `To exercise any of these, contact ${privacyEmail()}. We will respond within the period the applicable law requires.`,
          "If you believe we have handled your data improperly, you may complain to your local supervisory authority. We would rather you told us first.",
        ],
      },
      {
        heading: "Security",
        body: [
          "Access to your data is scoped to your organisation, uploaded files are private by default and served through expiring links, and administrative accounts require two-factor authentication.",
          "No service is perfectly secure. If a breach affects your personal data, we will notify you and the relevant authority where the law requires it.",
        ],
      },
      {
        heading: "Children",
        body: [
          "The service is not directed to children, and we do not knowingly collect their personal data. [Set the minimum age your jurisdiction requires and state it here.]",
        ],
      },
      {
        heading: "Changes to this policy",
        body: [
          "We will post any change here and update the effective date above. If a change materially affects your rights, we will tell you before it takes effect.",
        ],
      },
    ],
  };
}

export function buildTermsOfService(): LegalDocument {
  return {
    title: "Terms of Service",
    effectiveDate: LegalData.effectiveDate,
    sections: [
      {
        heading: "Agreement",
        body: [
          `These terms are an agreement between you and ${entity()}, of ${address()}. By creating an account or using the service, you accept them. If you are accepting on behalf of an organisation, you confirm you may bind it.`,
        ],
      },
      {
        heading: "The service",
        body: [
          "We provide the software described on this site, as it exists at the time you use it. We may add, change, or remove features.",
        ],
      },
      {
        heading: "Your account",
        body: [
          "You must provide accurate information, keep your credentials secure, and be old enough to form a binding contract where you live.",
          "You are responsible for activity under your account and for the members you invite into your organisation.",
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          "Do not use the service to break the law, to infringe anyone's rights, to send unsolicited bulk messages, to store or distribute malware, or to attack the service or the people using it.",
          "Do not attempt to circumvent usage limits, access another organisation's data, or resell the service unless we have agreed in writing.",
        ],
      },
      {
        heading: "Plans, credits, and payment",
        body: [
          "Paid plans are billed in advance through our payment processor on the interval shown at checkout, and renew automatically until cancelled.",
          "Credits and usage allowances are granted according to your plan. Where credits expire, the expiry is shown at the time they are granted.",
          "Only an organisation owner can start, change, or cancel a subscription for that organisation.",
          "We may change prices. A change takes effect at your next renewal, and we will tell you before it does.",
        ],
      },
      {
        heading: "Cancellation and refunds",
        body: [
          "You can cancel at any time. Cancellation stops the next renewal; your plan continues until the end of the period you have paid for.",
          "[State your refund policy here. Payment processors and consumer law in several jurisdictions require a clear one, and 'no refunds' is not enforceable everywhere.]",
        ],
      },
      {
        heading: "Your content",
        body: [
          "You keep all rights in the content you upload. You grant us only the licence we need to host, process, and display it in order to run the service for you.",
          "You are responsible for having the rights to the content you upload.",
        ],
      },
      {
        heading: "Our intellectual property",
        body: [
          "We keep all rights in the service itself, including its software, design, and trade marks. These terms grant you a limited, non-exclusive, non-transferable right to use it.",
        ],
      },
      {
        heading: "Suspension and termination",
        body: [
          "You may stop using the service and close your account at any time.",
          "We may suspend or terminate access if you materially breach these terms, if your payment fails and stays unresolved, or if we must do so by law. Where it is reasonable to do so, we will warn you first.",
          "On termination, your right to use the service ends. Provisions that by their nature should survive — payment owed, intellectual property, disclaimers, limitation of liability, and governing law — do.",
        ],
      },
      {
        heading: "Disclaimers",
        body: [
          "The service is provided as is and as available. To the fullest extent the law allows, we disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement.",
          "Nothing here excludes liability that cannot lawfully be excluded, and consumer rights that apply to you are unaffected.",
        ],
      },
      {
        heading: "Limitation of liability",
        body: [
          "To the fullest extent the law allows, neither party is liable for indirect, incidental, special, or consequential loss, or for lost profits or lost data.",
          "[Set your liability cap here — commonly the amount paid in the preceding twelve months — and have counsel confirm it is enforceable in your jurisdiction.]",
        ],
      },
      {
        heading: "Governing law",
        body: [
          `These terms are governed by ${law()}, and disputes will be resolved there.`,
        ],
      },
      {
        heading: "Changes to these terms",
        body: [
          "We may update these terms. We will post the new version here with a new effective date, and where a change materially affects your rights we will tell you before it takes effect. Continuing to use the service after that means you accept the change.",
        ],
      },
      {
        heading: "Contact",
        body: [`Questions about these terms: ${legalEmail()}.`],
      },
    ],
  };
}

export const LegalConfig = {
  ...LegalData,

  /**
   * False while any identity field is still a placeholder. Drives the
   * unreviewed-draft notice on both pages.
   */
  get isConfigured(): boolean {
    return Boolean(
      LegalData.entityName &&
        LegalData.entityAddress &&
        LegalData.privacyContactEmail &&
        LegalData.legalContactEmail &&
        LegalData.governingLaw
    );
  },
} as const;
