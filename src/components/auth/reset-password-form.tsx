"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";
import { AUTH_ROUTES, withLocale } from "@/data/auth";

export default function ResetPasswordForm() {
  const t = useTranslations("auth");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale;
  const router = useRouter();
  const search = useSearchParams();
  const token = search?.get("token") ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "");
  const errorQuery = search?.get("error");

  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (errorQuery && !message && !error) {
      setError(errorQuery === "INVALID_TOKEN" ? t("errorInvalidToken") : errorQuery);
    }
  }, [errorQuery, message, error, t]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      if (!token) {
        setError(t("errorInvalidToken"));
        return;
      }
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        setError(error.message ?? t("errorGeneric"));
      } else {
        setMessage(t("msgResetDone"));
        setTimeout(() => router.replace(withLocale(locale, AUTH_ROUTES.login)), 800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("resetSubtitle")}</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">{t("password")}</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring focus-visible:ring-primary/40"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
              disabled={isSubmitting}
            />
          </div>
          {message && <p className="text-sm text-emerald-500">{message}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("updating") : t("resetPassword")}
          </button>
        </form>

        <div className="text-center">
          <button
            className="text-sm text-primary hover:underline"
            onClick={() => router.push(withLocale(locale, AUTH_ROUTES.login))}
            disabled={isSubmitting}
          >
            {t("backToLogin")}
          </button>
        </div>
      </div>
    </div>
  );
}
