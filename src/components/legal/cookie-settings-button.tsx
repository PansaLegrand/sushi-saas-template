"use client";

import { useTranslations } from "next-intl";

import { useConsent } from "@/providers/consent";
import { hasConsentGatedScripts } from "@/config/analytics";

/**
 * Reopens the consent banner.
 *
 * Withdrawing consent has to be as easy as giving it, which in practice means a
 * persistent control rather than a one-time banner. Renders nothing when the
 * deployment has no gated scripts, so a fresh clone gets no dead link.
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useTranslations("legal.cookies");
  const { openPrompt } = useConsent();

  if (!hasConsentGatedScripts()) return null;

  return (
    <button type="button" onClick={openPrompt} className={className}>
      {t("settingsLink")}
    </button>
  );
}
