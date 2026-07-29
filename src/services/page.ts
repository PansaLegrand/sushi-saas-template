import { Pricing } from "@/types/blocks/pricing";
import { getPricingConfig } from "@/config/pricing";

type PricingPagePayload = {
  pricing?: Pricing;
};

/**
 * Keep this as a plain in-process read. Pricing is code configuration, not I/O;
 * putting it in Next's persistent data cache made catalog copy stay stale after
 * a deployment or local edit until the one-hour TTL elapsed.
 */
export async function getPricingPage(
  locale: string,
): Promise<PricingPagePayload> {
  const pricing = getPricingConfig(locale);

  return { pricing };
}
