"use client";

import { useConsent } from "@/providers/consent";

/**
 * AdSense tag. Gated on the `advertising` category rather than `analytics`:
 * they are separate decisions, and a visitor who accepts measurement has not
 * thereby accepted ad personalisation.
 */
export default function Adsense() {
  const { allows } = useConsent();

  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const googleAdsenseCode = process.env.NEXT_PUBLIC_GOOGLE_ADCODE;

  if (!googleAdsenseCode) {
    return null;
  }

  if (!allows("advertising")) {
    return null;
  }

  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${googleAdsenseCode}`}
      crossOrigin="anonymous"
    ></script>
  );
}
