"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, MailCheck, RefreshCw } from "lucide-react";

import { authClient, signIn, signUp, useSession } from "@/lib/auth-client";
import { AUTH_ROUTES, withLocale } from "@/config/auth";
import { captchaHeaders } from "@/lib/captcha";
import {
  resolveAuthError,
  resolveAuthErrorCode,
} from "@/lib/errors/auth-client";
import { safeAuthCallbackPath } from "@/lib/auth-callback";
import {
  Turnstile,
  canSubmitWithCaptcha,
  type TurnstileHandle,
} from "@/components/auth/turnstile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type AuthMode = "signIn" | "signUp";

interface AuthScreenProps {
  callbackUrl?: string;
  initialMode?: AuthMode;
}

interface FormState {
  email: string;
  password: string;
  name: string;
}

const INITIAL_STATE: FormState = {
  email: "",
  password: "",
  name: "",
};

export function AuthScreen({
  callbackUrl,
  initialMode = "signIn",
}: AuthScreenProps) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "";
  const router = useRouter();
  const session = useSession();
  const t = useTranslations("auth");
  const callbackPath = useMemo(
    () =>
      safeAuthCallbackPath(callbackUrl) ??
      withLocale(locale, AUTH_ROUTES.defaultCallback),
    [callbackUrl, locale],
  );

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null,
  );
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  useEffect(() => {
    setMode(initialMode);
    setVerificationEmail(null);
  }, [initialMode]);

  const buildPath = useCallback(
    (path: string = "") => (path ? withLocale(locale, path) : callbackPath),
    [callbackPath, locale],
  );

  const buildAuthPath = useCallback(
    (path: string) => {
      const localizedPath = withLocale(locale, path);
      return safeAuthCallbackPath(callbackUrl)
        ? `${localizedPath}?callbackUrl=${encodeURIComponent(callbackPath)}`
        : localizedPath;
    },
    [callbackPath, callbackUrl, locale],
  );

  useEffect(() => {
    if (session.data) {
      router.replace(buildPath());
    }
  }, [session.data, router, buildPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!canSubmitWithCaptcha(captchaToken)) {
      setErrorMessage(t("captchaRequired"));
      return;
    }

    setSubmitting(true);
    const fetchOptions = { headers: captchaHeaders(captchaToken) };

    try {
      if (mode === "signIn") {
        const { data, error } = await signIn.email({
          email: form.email,
          password: form.password,
          callbackURL: buildPath(),
          fetchOptions,
        });

        if (error) {
          if (resolveAuthErrorCode(error) === "AUTH_EMAIL_NOT_VERIFIED") {
            setSuccessMessage(t("msgVerifyEmailPending"));
            setVerificationEmail(form.email);
            setForm((state) => ({
              email: state.email,
              password: "",
              name: "",
            }));
          } else {
            setErrorMessage(resolveAuthError(error, locale));
          }
        } else if ((data as any)?.twoFactorRedirect) {
          const verificationPath = withLocale(locale, "/two-factor");
          router.replace(
            `${verificationPath}?callbackUrl=${encodeURIComponent(callbackPath)}`,
          );
        } else {
          router.replace(buildPath());
        }
      } else {
        const { error } = await signUp.email({
          email: form.email,
          password: form.password,
          name: form.name || form.email,
          callbackURL: buildPath(),
          fetchOptions,
        });

        if (error) {
          setErrorMessage(resolveAuthError(error, locale));
        } else {
          setSuccessMessage(t("msgVerifyEmailSent"));
          setVerificationEmail(form.email);
          setForm((state) => ({ email: state.email, password: "", name: "" }));
        }
      }
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      // Turnstile tokens are single-use, so a new challenge is needed whether
      // this attempt succeeded or failed.
      turnstileRef.current?.reset();
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!verificationEmail) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    if (!canSubmitWithCaptcha(captchaToken)) {
      setErrorMessage(t("captchaRequired"));
      return;
    }

    setSubmitting(true);
    const fetchOptions = { headers: captchaHeaders(captchaToken) };

    try {
      const { error } = await authClient.sendVerificationEmail({
        email: verificationEmail,
        callbackURL: buildPath(),
        fetchOptions,
      });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
      } else {
        setSuccessMessage(t("msgVerifyEmailResent"));
      }
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      turnstileRef.current?.reset();
      setSubmitting(false);
    }
  };

  const resetSignup = () => {
    setMode("signUp");
    setVerificationEmail(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setForm(INITIAL_STATE);
    setCaptchaToken(null);
    router.replace(buildAuthPath(AUTH_ROUTES.signup));
  };

  const toggleMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setVerificationEmail(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setForm(INITIAL_STATE);

    const nextPath =
      nextMode === "signUp" ? AUTH_ROUTES.signup : AUTH_ROUTES.login;
    router.replace(buildAuthPath(nextPath));
  };

  const submitLabel = mode === "signIn" ? t("submitSignIn") : t("submitSignUp");

  if (verificationEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
          <header className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold">{t("verifyEmailTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("verifyEmailSubtitle")}
            </p>
          </header>

          <Alert role="status" variant="success">
            <MailCheck aria-hidden className="text-emerald-600" />
            <AlertTitle>{t("verifyEmailStatusTitle")}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{successMessage ?? t("msgVerifyEmailSent")}</p>
              <p className="break-all font-medium text-foreground">
                {verificationEmail}
              </p>
              <p>{t("verifyEmailInstructions")}</p>
            </AlertDescription>
          </Alert>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <Turnstile
            ref={turnstileRef}
            onToken={setCaptchaToken}
            onError={() => setErrorMessage(t("captchaFailed"))}
            className="flex justify-center"
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={handleResendVerification}
              disabled={isSubmitting}
              className="w-full gap-2"
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              {isSubmitting ? t("sending") : t("resendVerificationEmail")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetSignup}
              disabled={isSubmitting}
              className="w-full gap-2"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
              {t("useDifferentEmail")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">
            {mode === "signIn" ? t("signInTitle") : t("signUpTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signIn" ? t("signInSubtitle") : t("signUpSubtitle")}
          </p>
        </header>

        <div className="flex gap-2 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => toggleMode("signIn")}
            aria-pressed={mode === "signIn"}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
              mode === "signIn"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={isSubmitting}
          >
            {t("submitSignIn")}
          </button>
          <button
            type="button"
            onClick={() => toggleMode("signUp")}
            aria-pressed={mode === "signUp"}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
              mode === "signUp"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={isSubmitting}
          >
            {t("linkSignUp")}
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "signUp" && (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                {t("name")}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring focus-visible:ring-primary/40"
                value={form.name}
                onChange={(event) =>
                  setForm((state) => ({ ...state, name: event.target.value }))
                }
                placeholder="Jane Doe"
                disabled={isSubmitting}
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring focus-visible:ring-primary/40"
              value={form.email}
              onChange={(event) =>
                setForm((state) => ({ ...state, email: event.target.value }))
              }
              placeholder="you@example.com"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring focus-visible:ring-primary/40"
              value={form.password}
              onChange={(event) =>
                setForm((state) => ({ ...state, password: event.target.value }))
              }
              placeholder="••••••••"
              minLength={8}
              required
              disabled={isSubmitting}
            />
            {mode === "signIn" && (
              <div className="mt-1 text-right">
                <a
                  className="text-xs text-primary hover:underline"
                  href={buildPath(AUTH_ROUTES.forgotPassword)}
                >
                  {t("forgotPassword")}
                </a>
              </div>
            )}
          </div>

          <Turnstile
            ref={turnstileRef}
            onToken={setCaptchaToken}
            onError={() => setErrorMessage(t("captchaFailed"))}
            className="flex justify-center"
          />

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          {successMessage && (
            <p className="text-sm text-emerald-500">{successMessage}</p>
          )}

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("pleaseWait") : submitLabel}
          </button>
        </form>

        {/* Social sign-in */}
        <div className="flex items-center gap-3 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">
            {t("orContinueWith")}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          onClick={() =>
            signIn.social({
              provider: "google",
              callbackURL: buildPath(),
              errorCallbackURL: buildAuthPath(AUTH_ROUTES.login),
            })
          }
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
        >
          {/* Simple G icon substitute */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden
          >
            <path
              fill="#EA4335"
              d="M12 10.2v3.84h5.34c-.24 1.26-1.6 3.7-5.34 3.7a6.18 6.18 0 1 1 0-12.36c1.76 0 2.94.74 3.62 1.38l2.46-2.38C16.7 3.38 14.6 2.5 12 2.5a9.5 9.5 0 1 0 0 19c5.48 0 9.08-3.84 9.08-9.24 0-.62-.06-1.1-.14-1.56H12Z"
            />
          </svg>
          {t("continueWithGoogle")}
        </button>

        {mode === "signIn" ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => toggleMode("signUp")}
              disabled={isSubmitting}
            >
              {t("linkSignUp")}
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => toggleMode("signIn")}
              disabled={isSubmitting}
            >
              {t("linkSignIn")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default AuthScreen;
