"use client";

import { GoogleAnalytics as NextGoogleAnalytics } from "@next/third-parties/google";

/**
 * Google Analytics injection using Next.js third-parties helper.
 * - Only renders in production.
 * - Requires `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` (e.g. "G-XXXXXXX").
 */
export function GoogleAnalytics() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const analyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  if (!analyticsId) {
    return null;
  }

  return <NextGoogleAnalytics gaId={analyticsId} />;
}

