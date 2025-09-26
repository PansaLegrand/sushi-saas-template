import { Pricing } from "@/types/blocks/pricing";
import { unstable_cache } from "next/cache";
import { getPricingConfig } from "@/data/pricing";

type PricingPagePayload = {
  pricing?: Pricing;
};

export const getPricingPage = unstable_cache(
  async (locale: string): Promise<PricingPagePayload> => {
    const pricing = getPricingConfig(locale);

    return { pricing };
  },
  ["pricing-page"],
  {
    revalidate: 3600,
  }
);
