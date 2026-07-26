"use client";

import { GoogleAnalytics as NextGoogleAnalytics } from "@next/third-parties/google";

import { useConsent } from "@/providers/consent";

/**
 * Google Analytics injection using Next.js third-parties helper.
 * - Only renders in production.
 * - Requires `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` (e.g. "G-XXXXXXX").
 * - Requires the visitor to have accepted analytics cookies.
 *
 * The consent check gates rendering the script tag, not a flag inside gtag.
 * Loading the tag and then asking it not to track still sets cookies and still
 * contacts Google, which is the part consent law is actually about.
 */
export function GoogleAnalytics() {
  const { allows } = useConsent();

  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const analyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  if (!analyticsId) {
    return null;
  }

  if (!allows("analytics")) {
    return null;
  }

  return <NextGoogleAnalytics gaId={analyticsId} />;
}

