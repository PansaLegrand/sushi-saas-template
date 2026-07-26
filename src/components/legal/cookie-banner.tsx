"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useConsent } from "@/providers/consent";
import { DENY_ALL, type ConsentState } from "@/lib/consent";
import { hasConsentGatedScripts } from "@/config/analytics";

/**
 * Cookie consent banner.
 *
 * Two rules drive the design, both of them legal rather than aesthetic:
 *
 * 1. Reject is exactly as easy as accept — same surface, same prominence, one
 *    click. A banner where refusing takes an extra step through a settings
 *    screen is the pattern regulators have repeatedly fined.
 * 2. Nothing loads before a decision. The banner does not gate the scripts; the
 *    scripts gate themselves on `useConsent()`. This is only the UI for it.
 *
 * It renders nothing at all when the deployment has no consent-gated scripts
 * configured, because then there is nothing to consent to. A banner asking
 * permission to set cookies that do not exist trains people to click through.
 */
export function CookieBanner() {
  const t = useTranslations("legal.cookies");
  const { ready, decided, promptOpen, acceptAll, rejectAll, save, state, closePrompt } =
    useConsent();
  const [customising, setCustomising] = useState(false);
  const [draft, setDraft] = useState<ConsentState>(state ?? { ...DENY_ALL });

  if (!hasConsentGatedScripts()) return null;
  if (!ready) return null;
  if (decided && !promptOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t("title")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur"
    >
      <div className="container flex flex-col gap-4 py-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("description")}{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t("privacyLink")}
            </Link>
          </p>
        </div>

        {customising ? (
          <fieldset className="space-y-3 border-t border-border/60 pt-4">
            <legend className="sr-only">{t("customise")}</legend>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked
                disabled
                className="mt-1"
                aria-describedby="consent-necessary-help"
              />
              <span>
                <span className="font-medium">{t("categories.necessary.label")}</span>
                <span
                  id="consent-necessary-help"
                  className="block text-muted-foreground"
                >
                  {t("categories.necessary.description")}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={draft.analytics}
                onChange={(e) => setDraft({ ...draft, analytics: e.target.checked })}
                className="mt-1"
                aria-describedby="consent-analytics-help"
              />
              <span>
                <span className="font-medium">{t("categories.analytics.label")}</span>
                <span
                  id="consent-analytics-help"
                  className="block text-muted-foreground"
                >
                  {t("categories.analytics.description")}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={draft.advertising}
                onChange={(e) => setDraft({ ...draft, advertising: e.target.checked })}
                className="mt-1"
                aria-describedby="consent-advertising-help"
              />
              <span>
                <span className="font-medium">{t("categories.advertising.label")}</span>
                <span
                  id="consent-advertising-help"
                  className="block text-muted-foreground"
                >
                  {t("categories.advertising.description")}
                </span>
              </span>
            </label>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {customising ? (
            <button
              type="button"
              onClick={() => save(draft)}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            >
              {t("saveChoices")}
            </button>
          ) : (
            <button
              type="button"
              onClick={acceptAll}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            >
              {t("acceptAll")}
            </button>
          )}

          {/* Same visual weight as accept. This is the point. */}
          <button
            type="button"
            onClick={rejectAll}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
          >
            {t("rejectAll")}
          </button>

          {!customising ? (
            <button
              type="button"
              onClick={() => {
                setDraft(state ?? { ...DENY_ALL });
                setCustomising(true);
              }}
              className="text-sm text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
            >
              {t("customise")}
            </button>
          ) : null}

          {decided && promptOpen ? (
            <button
              type="button"
              onClick={closePrompt}
              className="text-sm text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
            >
              {t("close")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
