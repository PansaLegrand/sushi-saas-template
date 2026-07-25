"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@admin/lib/auth-client";
import { captchaHeaders } from "@/lib/captcha";
import { resolveAuthError } from "@/lib/errors/auth-client";
import {
  Turnstile,
  canSubmitWithCaptcha,
  type TurnstileHandle,
} from "@/components/auth/turnstile";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    // Admin sign-in uses the same /sign-in/email endpoint as the public app, so
    // the same challenge applies here.
    if (!canSubmitWithCaptcha(captchaToken)) {
      setErrorMessage("Please complete the verification challenge.");
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await signIn.email({
        email,
        password,
        callbackURL: "/",
        fetchOptions: { headers: captchaHeaders(captchaToken) },
      });

      if (error) {
        setErrorMessage(resolveAuthError(error));
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setErrorMessage(resolveAuthError(null));
    } finally {
      turnstileRef.current?.reset();
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block space-y-2 text-sm font-medium">
        <span>Email</span>
        <input
          className="w-full rounded-md border px-3 py-2"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
        />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        <span>Password</span>
        <input
          className="w-full rounded-md border px-3 py-2"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
      </label>
      <Turnstile
        ref={turnstileRef}
        onToken={setCaptchaToken}
        onError={() => setErrorMessage("Verification failed. Please try again.")}
        className="flex justify-center"
      />

      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      <button
        className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
