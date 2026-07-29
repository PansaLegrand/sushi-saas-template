import {
  BILLING_PRODUCTS,
  PLAN_MONTHLY_CREDITS,
  type BillingProduct,
  type BillingProductId,
} from "@/config/billing";
import type { Pricing, PricingItem } from "@/types/blocks/pricing";

type ProductPresentation = Omit<
  PricingItem,
  | "interval"
  | "product_id"
  | "product_name"
  | "currency"
  | "amount"
  | "cn_amount"
>;

const PRODUCT_PRESENTATION: Record<BillingProductId, ProductPresentation> = {
  "plus-monthly": {
    title: "Plus",
    description:
      "Core usage and collaboration limits for launching your first paid plan.",
    label: "Popular",
    original_price: "$39",
    unit: "/month",
    features_title: "Plus includes",
    features: [
      `${PLAN_MONTHLY_CREDITS.plus} pooled usage credits every month`,
      "Better Auth flows",
      "Private uploads and durable jobs",
      "Email onboarding templates",
    ],
    button: {
      title: "Choose Plus",
      icon: "ArrowRight",
    },
    tip: "Cancel anytime. Credits reset every month.",
    is_featured: true,
    group: "monthly",
  },
  "max-monthly": {
    title: "Max",
    description:
      "Switch on higher limits, priority support, and bulk credit pools.",
    label: "Teams",
    unit: "/month",
    features_title: "Max includes",
    features: [
      `${PLAN_MONTHLY_CREDITS.max} pooled usage credits every month`,
      "Higher task and storage limits",
      "Priority email support",
      "Role-based access control",
    ],
    button: {
      title: "Choose Max",
      icon: "Sparkle",
    },
    tip: "Great for teams that are onboarding paying users.",
    group: "monthly",
  },
  "plus-yearly": {
    title: "Plus",
    description: "Pay once, stay shipped with 12 months of runway credits.",
    original_price: "$348",
    unit: "/year",
    features_title: "Yearly perks",
    features: [
      `${PLAN_MONTHLY_CREDITS.plus * 12} pooled usage credits upfront`,
      "Free migration review",
      "Annual roadmap session",
    ],
    button: {
      title: "Plan launch",
      icon: "Calendar",
    },
    group: "yearly",
  },
  "max-yearly": {
    title: "Max",
    description: "Unlock top-tier credits with annual savings baked in.",
    original_price: "$948",
    unit: "/year",
    features_title: "Max yearly includes",
    features: [
      `${PLAN_MONTHLY_CREDITS.max * 12} pooled usage credits upfront`,
      "Success architect onboarding",
      "Quarterly review workshops",
    ],
    button: {
      title: "Go annual",
      icon: "Layers",
    },
    group: "yearly",
  },
};

function formatUsd(amount: number): string {
  return `$${amount / 100}`;
}

function pricingItem(product: BillingProduct): PricingItem {
  const usd = product.prices.usd;
  if (!usd) {
    // USD is the catalog's default display currency. Production validation
    // separately requires its Stripe Price ID; this guards code edits that
    // remove the variant altogether.
    throw new Error(`billing product "${product.id}" has no USD price`);
  }

  return {
    ...PRODUCT_PRESENTATION[product.id],
    price: formatUsd(usd.amount),
    interval: product.interval,
    product_id: product.id,
    product_name: product.name,
    amount: usd.amount,
    cn_amount: product.prices.cny?.stripePriceIds[0]
      ? product.prices.cny.amount
      : undefined,
    currency: usd.currency,
  };
}

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
    "Choose the capacity you need now. Add another subscription later when your credit pool needs to grow.",
  groups: SHARED_GROUPS,
  items: BILLING_PRODUCTS.map(pricingItem),
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
