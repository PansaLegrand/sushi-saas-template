"use client";

import { useEffect } from "react";

export default function AffiliateInit() {
  useEffect(() => {
    const key = "affiliate-attribution-ok";
    if (sessionStorage.getItem(key)) return;

    (async () => {
      try {
        const res = await fetch("/api/affiliate/update-invite", {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          sessionStorage.setItem(key, "1");
        }
      } catch {
        // ignore; will retry on next navigation until it succeeds once
      }
    })();
  }, []);
  return null;
}
