// Centralized configuration + types for the affiliate/invite system.
// Numbers use minor units (e.g. cents) to match Stripe orders.

export enum AffiliateStatus {
  Pending = "pending",
  Completed = "completed",
  Canceled = "canceled",
  Ignored = "ignored",
}

export enum AttributionModel {
  FirstTouch = "first_touch",
  LastTouch = "last_touch",
}

export enum CommissionMode {
  FixedOnly = "fixed_only",
  PercentOnly = "percent_only",
  GreaterOf = "greater_of",
  Sum = "sum",
}

export const AffiliateRewardPercent = {
  Invited: 0, // percent at signup (0 disables payout on signup)
  Paid: 20, // percent of order amount for paid orders
} as const;

export const AffiliateRewardAmount = {
  Invited: 0, // fixed amount (minor units) at signup
  Paid: 5_000, // $50.00 in cents for paid orders
} as const;

export const AffiliateConfig = {
  enabled: true,
  // Link structure
  sharePath: "/i", // final link: `${WEB_URL}${sharePath}/${inviteCode}`
  myInvitesPath: "/[locale]/my-invites",

  // Cookie & attribution
  cookieName: "ref",
  attributionWindowDays: 30,
  allowSelfReferral: false,
  attributionModel: AttributionModel.FirstTouch,

  // Payout representation
  // - "cash": reward_amount represents minor currency units (e.g., cents)
  // - "credits": reward_amount represents in-app credits to grant the inviter
  // payoutType: "cash" as "cash" | "credits",
  payoutType: "credits" as "cash" | "credits",
  // Rewards
  commissionMode: CommissionMode.GreaterOf,
  signup: {
    fixed: AffiliateRewardAmount.Invited,
    percent: AffiliateRewardPercent.Invited,
  },
  paid: {
    fixed: AffiliateRewardAmount.Paid,
    percent: AffiliateRewardPercent.Paid,
  },
} as const;

export type AffiliateConfigType = typeof AffiliateConfig;
