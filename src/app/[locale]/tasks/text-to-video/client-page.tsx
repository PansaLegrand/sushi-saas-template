"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { getCreditSummary } from "@/api/credits";
import { createTextToVideoTask, getTask } from "@/api/tasks";
import { ErrorBanner } from "@/components/errors/error-banner";
import { Link } from "@/i18n/navigation";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";

export default function TextToVideoClientPage() {
  const t = useTranslations("tasks.textToVideo");
  const locale = useLocale();
  const [prompt, setPrompt] = useState<string>("");
  const [seconds, setSeconds] = useState<string>("8");
  const [aspect, setAspect] = useState<string>("landscape");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [taskUuid, setTaskUuid] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);
  const [isAuthed, setIsAuthed] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const canSubmit = useMemo(() => prompt.trim().length > 0 && !isSubmitting, [prompt, isSubmitting]);

  // Soft auth check so we can guide the user to sign up before submitting.
  useEffect(() => {
    (async () => {
      try {
        await getCreditSummary({ includeLedger: false, includeExpiring: false });
        setIsAuthed(true);
      } catch {
        setIsAuthed(false);
      }
    })();
  }, []);

  const submit = useCallback(async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setOutputUrl(null);
    setTaskUuid(null);
    setCreditsUsed(null);

    try {
      const data = await createTextToVideoTask({
        prompt,
        seconds: Number(seconds) || 8,
        aspectRatio: aspect,
      });

      setOutputUrl(data.task.outputUrl ?? null);
      setTaskUuid(data.task.uuid);
      setCreditsUsed(data.task.creditsUsed);
    } catch (error) {
      // Two failures get feature-specific copy from `messages/`; everything else
      // resolves through the catalog. Both branches read the stable code rather
      // than sniffing the message text, which used to mean a copy edit on the
      // server silently disabled the "insufficient credits" case here.
      if (isClientApiError(error) && error.code === "AUTH_REQUIRED") {
        setIsAuthed(false);
        setErrorMessage(t("errorNotSignedIn"));
      } else if (isClientApiError(error) && error.code === "CREDITS_INSUFFICIENT") {
        setErrorMessage(t("insufficientCredits"));
      } else {
        setErrorMessage(resolveErrorMessage(error, locale, "TASK_CREATE_FAILED"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, seconds, aspect, t, locale]);

  const refreshTask = useCallback(async () => {
    if (!taskUuid) return;
    setIsRefreshing(true);
    setErrorMessage(null);
    try {
      const data = await getTask(taskUuid);
      setOutputUrl(data.task.outputUrl ?? null);
    } catch (error) {
      if (isClientApiError(error) && error.code === "AUTH_REQUIRED") {
        setIsAuthed(false);
        setErrorMessage(t("errorNotSignedIn"));
      } else {
        setErrorMessage(resolveErrorMessage(error, locale));
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [taskUuid, t, locale]);

  return (
    <main className="container mx-auto flex max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <section>
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich("intro", {
            code: (chunks) => (
              <code className="ml-1">{chunks}</code>
            ),
          })}
        </p>
      </section>

      {errorMessage ? (
        <ErrorBanner
          title={t("errorTitle")}
          message={errorMessage}
          details={[t("errorDetails")]} 
        />
      ) : null}

      {!isAuthed ? (
        <section className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm">
            <span className="font-medium">{t("notSignedInTitle")}:</span> {t("notSignedInDesc")}
            {" "}
            <Link href="/signup" className="underline">
              {t("linkSignup")}
            </Link>{" "}
            {t("or")}{" "}
            <Link href="/login" className="underline">
              {t("linkLogin")}
            </Link>
            .
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="prompt" className="text-sm font-medium">{t("promptLabel")}</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              placeholder={t("promptPlaceholder")}
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="seconds" className="text-sm font-medium">{t("secondsLabel")}</label>
              <input
                id="seconds"
                type="number"
                min={1}
                step={1}
                value={seconds}
                onChange={(e) => setSeconds(e.currentTarget.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="aspect" className="text-sm font-medium">{t("aspectLabel")}</label>
              <select
                id="aspect"
                value={aspect}
                onChange={(e) => setAspect(e.currentTarget.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <option value="landscape">{t("aspectLandscape")}</option>
                <option value="portrait">{t("aspectPortrait")}</option>
                <option value="square">{t("aspectSquare")}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || !isAuthed}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? t("generating") : t("generate")}
            </button>

            {creditsUsed !== null ? (
              <span className="text-sm text-muted-foreground">{t("spent", { n: creditsUsed })}</span>
            ) : null}

            {taskUuid ? (
              <button
                type="button"
                onClick={() => void refreshTask()}
                disabled={isRefreshing}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ? t("refreshing") : t("refresh")}
              </button>
            ) : null}
          </div>
        </div>

        {taskUuid ? (
          <p className="mt-4 text-xs text-muted-foreground">{t("taskId")}: {taskUuid}</p>
        ) : null}

        {outputUrl ? (
          <div className="mt-6">
            <h2 className="text-base font-semibold">{t("resultTitle")}</h2>
            <video
              className="mt-3 w-full rounded-lg border border-border"
              src={outputUrl}
              controls
            />
            <p className="mt-2 text-xs text-muted-foreground break-all">{t("urlLabel")}: {outputUrl}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
