"use client";

import { FormEvent, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";
import { AUTH_ROUTES, withLocale, absoluteWithLocale } from "@/config/auth";
import { captchaHeaders } from "@/lib/captcha";
import { resolveAuthError } from "@/lib/errors/auth-client";
import {
  Turnstile,
  canSubmitWithCaptcha,
  type TurnstileHandle,
} from "@/components/auth/turnstile";

export default function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale;
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    if (!canSubmitWithCaptcha(captchaToken)) {
      setError(t("captchaRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = absoluteWithLocale(locale, AUTH_ROUTES.resetPassword);
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo,
        fetchOptions: { headers: captchaHeaders(captchaToken) },
      });
      if (error) {
        setError(resolveAuthError(error, locale));
      } else {
        setMessage(t("msgResetSent"));
      }
    } catch {
      setError(resolveAuthError(null, locale));
    } finally {
      // Single-use token: force a fresh challenge for any retry.
      turnstileRef.current?.reset();
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">{t("forgotTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("forgotSubtitle")}</p>
        </header>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">{t("email")}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring focus-visible:ring-primary/40"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={isSubmitting}
            />
          </div>
          <Turnstile
            ref={turnstileRef}
            onToken={setCaptchaToken}
            onError={() => setError(t("captchaFailed"))}
            className="flex justify-center"
          />

          {message && <p className="text-sm text-emerald-500">{message}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("sending") : t("sendResetLink")}
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
