"use client";

import { FormEvent, useState } from "react";
import { useParams } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { resolveAuthError } from "@/lib/errors/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface TwoFactorSetupPanelProps {
  initialEnabled: boolean;
}

export function TwoFactorSetupPanel({ initialEnabled }: TwoFactorSetupPanelProps) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "";

  const [enabled, setEnabled] = useState(initialEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const startSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const { data, error } = await authClient.twoFactor.enable({
        password,
      });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
        return;
      }

      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
      setSuccessMessage("Add this account to your authenticator, then enter the code it shows.");
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const verifySetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code,
      });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
        return;
      }

      setEnabled(true);
      setCode("");
      setPassword("");
      setTotpURI(null);
      setSuccessMessage("Two-factor authentication is enabled. Store your backup codes somewhere safe.");
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      setSubmitting(false);
    }
  };

  const disable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const { error } = await authClient.twoFactor.disable({
        password,
      });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
        return;
      }

      setEnabled(false);
      setPassword("");
      setCode("");
      setTotpURI(null);
      setBackupCodes([]);
      setSuccessMessage("Two-factor authentication is disabled.");
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Security</h2>
        <p className="text-sm text-muted-foreground">
          Admin accounts must enable two-factor authentication before they can use the admin console.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
        <span>Two-factor authentication</span>
        <span className={enabled ? "text-emerald-600" : "text-muted-foreground"}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert variant="success" role="status">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {totpURI ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Authenticator URI</p>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
              {totpURI}
            </pre>
          </div>

          {backupCodes.length > 0 ? (
            <Alert variant="warning" role="status">
              <AlertTitle>Backup codes</AlertTitle>
              <AlertDescription>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {backupCodes.map((backupCode) => (
                    <code key={backupCode} className="rounded bg-background px-2 py-1 text-xs">
                      {backupCode}
                    </code>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={verifySetup}>
            <Field label="Authenticator code" required>
              {(field) => (
                <Input
                  {...field}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  required
                />
              )}
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Verifying..." : "Verify and enable"}
            </Button>
          </form>
        </div>
      ) : enabled ? (
        <form className="space-y-4" onSubmit={disable}>
          <Field label="Password" required>
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            {isSubmitting ? "Disabling..." : "Disable two-factor"}
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={startSetup}>
          <Field
            label="Password"
            description="Confirm your password before creating an authenticator secret."
            required
          >
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Starting..." : "Enable two-factor"}
          </Button>
        </form>
      )}
    </section>
  );
}

export default TwoFactorSetupPanel;
