"use client";

import { FormEvent, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { resolveAuthError } from "@/lib/errors/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type VerificationMode = "totp" | "backup";

export function TwoFactorVerifyForm() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "";
  const router = useRouter();

  const [mode, setMode] = useState<VerificationMode>("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const { error } =
        mode === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
          : await authClient.twoFactor.verifyTotp({ code, trustDevice });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
        return;
      }

      router.replace(locale ? `/${locale}` : "/");
      router.refresh();
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label={mode === "backup" ? "Backup code" : "Authenticator code"} required>
        {(field) => (
          <Input
            {...field}
            inputMode={mode === "backup" ? "text" : "numeric"}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            required
          />
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.currentTarget.checked)}
          className="size-4 rounded border-input"
        />
        Trust this device
      </label>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Verifying..." : "Verify"}
      </Button>

      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => {
          setMode((current) => (current === "totp" ? "backup" : "totp"));
          setCode("");
          setErrorMessage(null);
        }}
      >
        {mode === "totp" ? "Use a backup code" : "Use an authenticator code"}
      </Button>
    </form>
  );
}

export default TwoFactorVerifyForm;
