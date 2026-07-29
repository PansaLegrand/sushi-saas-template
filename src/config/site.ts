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

export const SiteConfig = {
  brand: process.env.NEXT_PUBLIC_APP_NAME || "Your SaaS",

  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL || null,

  contactEmail: null as string | null,
} as const;
