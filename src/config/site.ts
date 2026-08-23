/**
 * Deployment identity for the SaaS application.
 *
 * Public documentation and editorial content live in a separate repository.
 * This file holds only the small amount of identity the product runtime itself
 * needs: its name, an optional external docs URL, and an optional support
 * address.
 *
 * Defaults stay neutral so a clone never publishes the starter maintainer's
 * identity or domain.
 */

import {
  productConfig,
  runtimeDocsUrl,
  runtimeProductName,
} from "@/config/product";

export const SiteConfig = {
  brand: runtimeProductName(),

  docsUrl: runtimeDocsUrl(),

  contactEmail: productConfig.product.supportEmail,
} as const;
