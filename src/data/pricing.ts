import type { Pricing } from "@/types/blocks/pricing";

const sharedMonthlyPlans = [
  {
    title: "Launch",
    description:
      "Everything you need to validate v1 with auth, docs, and health monitoring.",
    label: "Popular",
    price: "$29",
    original_price: "$39",
    currency: "usd",
    unit: "/month",
    features_title: "Launch faster with",
    features: [
      "200 AI credits every month",
      "Better Auth flows",
      "Fumadocs blog + MDX",
      "Email onboarding templates",
    ],
    button: {
      title: "Start building",
      icon: "ArrowRight",
    },
    tip: "Cancel anytime. Credits reset every month.",
    is_featured: true,
    interval: "month" as const,
    product_id: "launch-monthly",
    product_name: "Launch Monthly",
    amount: 2_900,
    cn_amount: 19_900,
    credits: 200,
    valid_months: 1,
    group: "monthly",
    // Optional Stripe Price IDs; set via NEXT_PUBLIC_* so they’re safe to expose.
    price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY,
    cn_price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY,
  },
  {
    title: "Scale",
    description:
      "Switch on premium analytics, priority support, and bulk credit pools.",
    label: "Teams",
    price: "$79",
    currency: "usd",
    unit: "/month",
    features_title: "Scale includes",
    features: [
      "800 AI credits every month",
      "Usage analytics dashboard",
      "Slack + email support",
      "Role-based access control",
    ],
    button: {
      title: "Unlock Scale",
      icon: "Sparkle",
    },
    tip: "Great for teams that are onboarding paying users.",
    interval: "month" as const,
    product_id: "scale-monthly",
    product_name: "Scale Monthly",
    amount: 7_900,
    cn_amount: 54_900,
    credits: 800,
    valid_months: 1,
    group: "monthly",
    price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY,
    cn_price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY,
  },
];

const sharedYearlyPlans = [
  {
    title: "Launch",
    description: "Pay once, stay shipped with 12 months of runway credits.",
    price: "$299",
    original_price: "$348",
    currency: "usd",
    unit: "/year",
    features_title: "Yearly perks",
    features: [
      "2400 AI credits upfront",
      "Free migration review",
      "Annual roadmap session",
    ],
    button: {
      title: "Plan launch",
      icon: "Calendar",
    },
    interval: "year" as const,
    product_id: "launch-yearly",
    product_name: "Launch Yearly",
    amount: 29_900,
    cn_amount: 208_800,
    credits: 2_400,
    valid_months: 12,
    group: "yearly",
    price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY,
    cn_price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY,
  },
  {
    title: "Scale",
    description: "Unlock top-tier credits with annual savings baked in.",
    price: "$799",
    original_price: "$948",
    currency: "usd",
    unit: "/year",
    features_title: "Scale yearly includes",
    features: [
      "9600 AI credits upfront",
      "Success architect onboarding",
      "Quarterly review workshops",
    ],
    button: {
      title: "Scale annually",
      icon: "Layers",
    },
    interval: "year" as const,
    product_id: "scale-yearly",
    product_name: "Scale Yearly",
    amount: 79_900,
    cn_amount: 551_900,
    credits: 9_600,
    valid_months: 12,
    group: "yearly",
    price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY,
    cn_price_id: process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY,
  },
];

const SHARED_GROUPS: Pricing["groups"] = [
  {
    name: "monthly",
    title: "Monthly",
    description: "Try the template with a short commitment",
    is_featured: true,
  },
  {
    name: "yearly",
    title: "Yearly",
    description: "Best value for growing teams",
    label: "Save 2 months",
  },
];

const BASE_PRICING: Pricing = {
  disabled: false,
  name: "plans",
  title: "Plans built for shipping",
  description:
    "Pick a sandbox package and keep your credits topped up for production.",
  groups: SHARED_GROUPS,
  items: [...sharedMonthlyPlans, ...sharedYearlyPlans],
};

const LOCALE_OVERRIDES: Partial<Record<string, Partial<Pricing>>> = {
  es: {
    title: "Planes listos para publicar",
    description:
      "Escoge un paquete sandbox y mantén tus créditos cargados para producción.",
  },
  fr: {
    title: "Des formules prêtes à livrer",
    description:
      "Choisissez un pack sandbox et gardez vos crédits chargés pour la prod.",
  },
  ja: {
    title: "ローンチに備えたプラン",
    description:
      "サンドボックスパッケージで試しつつ、本番用クレジットも確保しましょう。",
  },
  zh: {
    title: "为上线准备的方案",
    description: "选择一个沙盒套餐，并保持生产环境的积分充足。",
  },
};

export function getPricingConfig(locale: string): Pricing {
  const normalized = locale?.split("-")[0]?.toLowerCase() ?? "en";
  const override = LOCALE_OVERRIDES[normalized];

  if (!override) {
    return BASE_PRICING;
  }

  return {
    ...BASE_PRICING,
    ...override,
  };
}
