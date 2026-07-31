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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
      const { data, error } = await signIn.email({
        email,
        password,
        callbackURL: "/",
        fetchOptions: { headers: captchaHeaders(captchaToken) },
      });

      if (error) {
        setErrorMessage(resolveAuthError(error));
        return;
      }

      if ((data as any)?.twoFactorRedirect) {
        router.replace("/two-factor");
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
    <form
      className="space-y-5"
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
    >
      <Field label="Email address" required>
        {(field) => (
          <Input
            {...field}
            className="h-11 text-base"
            type="email"
            autoComplete="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
        )}
      </Field>

      <Field label="Password" required>
        {(field) => (
          <Input
            {...field}
            className="h-11 text-base"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
        )}
      </Field>

      <Turnstile
        ref={turnstileRef}
        onToken={setCaptchaToken}
        onError={() =>
          setErrorMessage("Verification failed. Please try again.")
        }
        className="flex justify-center"
      />

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Button className="h-11 w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
