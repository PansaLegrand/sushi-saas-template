"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

import { signIn, signUp, useSession } from "@/lib/auth-client";

type AuthMode = "signIn" | "signUp";

interface AuthScreenProps {
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

export function AuthScreen({ initialMode = "signIn" }: AuthScreenProps) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "";
  const router = useRouter();
  const session = useSession();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const buildPath = useCallback(
    (path: string = "") => {
      const prefix = locale ? `/${locale}` : "";
      const suffix = path
        ? path.startsWith("/")
          ? path
          : `/${path}`
        : "";
      const full = `${prefix}${suffix}`;
      return full || "/";
    },
    [locale]
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
    setSubmitting(true);

    try {
      if (mode === "signIn") {
        const { error } = await signIn.email({
          email: form.email,
          password: form.password,
          callbackURL: buildPath(),
        });

        if (error) {
          setErrorMessage(error.message ?? "Unable to sign in.");
        } else {
          router.replace(buildPath());
        }
      } else {
        const { error } = await signUp.email({
          email: form.email,
          password: form.password,
          name: form.name || form.email,
          callbackURL: buildPath(),
        });

        if (error) {
          setErrorMessage(error.message ?? "Unable to sign up.");
        } else {
          setSuccessMessage("Account created successfully. Redirecting...");
          router.replace(buildPath());
        }
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage(null);
    setSuccessMessage(null);
    setForm(INITIAL_STATE);

    const nextPath = nextMode === "signUp" ? "/signup" : "/login";
    router.replace(buildPath(nextPath));
  };

  const submitLabel = mode === "signIn" ? "Log in" : "Create Account";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">
            {mode === "signIn" ? "Welcome back" : "Create an account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signIn"
              ? "Use your credentials to access your dashboard."
              : "Start your journey by filling in the details below."}
          </p>
        </header>

        <div className="flex gap-2 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => toggleMode("signIn")}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
              mode === "signIn"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={isSubmitting}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => toggleMode("signUp")}
            className={`flex-1 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
              mode === "signUp"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={isSubmitting}
          >
            Sign up
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "signUp" && (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                Name
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
              Email
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
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
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
          </div>

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
            {isSubmitting ? "Please wait…" : submitLabel}
          </button>
        </form>

        {/* Social sign-in */}
        <div className="flex items-center gap-3 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or continue with</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          onClick={() =>
            signIn.social({
              provider: "google",
              callbackURL: buildPath(),
              errorCallbackURL: buildPath("/login"),
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
            <path fill="#EA4335" d="M12 10.2v3.84h5.34c-.24 1.26-1.6 3.7-5.34 3.7a6.18 6.18 0 1 1 0-12.36c1.76 0 2.94.74 3.62 1.38l2.46-2.38C16.7 3.38 14.6 2.5 12 2.5a9.5 9.5 0 1 0 0 19c5.48 0 9.08-3.84 9.08-9.24 0-.62-.06-1.1-.14-1.56H12Z"/>
          </svg>
          Continue with Google
        </button>

        {mode === "signIn" ? (
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => toggleMode("signUp")}
              disabled={isSubmitting}
            >
              Sign up
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => toggleMode("signIn")}
              disabled={isSubmitting}
            >
              Log in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export default AuthScreen;
