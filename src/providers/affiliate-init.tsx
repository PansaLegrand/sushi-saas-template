"use client";

import { useEffect } from "react";
import { captureAffiliateAttribution } from "@/api/affiliate";
import { AffiliateConfig } from "@/config/affiliate";

export default function AffiliateInit() {
  useEffect(() => {
    if (!AffiliateConfig.enabled) return;

    const key = "affiliate-attribution-ok";
    if (sessionStorage.getItem(key)) return;

    captureAffiliateAttribution()
      .then(() => sessionStorage.setItem(key, "1"))
      // Best effort. Leave the marker absent so a later navigation repairs a
      // transient database or network failure.
      .catch(() => undefined);
  }, []);
  if (!AffiliateConfig.enabled) return null;
  return null;
}
