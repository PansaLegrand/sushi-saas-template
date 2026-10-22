"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";

/** UTC on the first render avoids a server/browser timezone hydration mismatch. */
export function useAccountTime() {
  const locale = useLocale();
  const [timeZone, setTimeZone] = useState("UTC");
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short",
  }), [locale, timeZone]);
  return (value: string) => formatter.format(new Date(value));
}
