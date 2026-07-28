"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";

import { setAccountPassword } from "@/api/account";
import { authClient } from "@/lib/auth-client";
import { resolveAuthError } from "@/lib/errors/auth-client";
import { resolveErrorMessage } from "@/lib/errors/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QrCode } from "@/components/ui/qr-code";

/**
 * Pull the base32 key out of an `otpauth://` URI.
 *
 * Apps that ask for a "setup key" want this and only this — pasting the whole
 * URI into that field fails with an unhelpful error. Parsed rather than
 * regex-matched so an added parameter cannot change what is captured.
 */
function extractTotpSecret(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

interface TwoFactorSetupPanelProps {
  initialEnabled: boolean;
  /**
   * False for an account created through Google, which has no password at all.
   *
   * Without this the panel asks such a user to "confirm your password" and every
   * answer fails — Better Auth has no credential to check against and reports
   * `INVALID_PASSWORD`, which reads as a typo rather than an impossibility. Since
   * admin roles cannot reach the console until two-factor auth is on, that was a
   * dead end with no way out from inside the app.
   */
  initialHasPassword: boolean;
  /** e.g. `["google"]`. Names the provider in the copy rather than guessing. */
  providers?: string[];
}

export function TwoFactorSetupPanel({
  initialEnabled,
  initialHasPassword,
  providers = [],
}: TwoFactorSetupPanelProps) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "";

  const [enabled, setEnabled] = useState(initialEnabled);
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const socialProvider = providers.find((provider) => provider !== "credential");

  const totpSecret = useMemo(
    () => (totpURI ? extractTotpSecret(totpURI) : null),
    [totpURI]
  );

  /** One code per line — what a password manager's note field and a text editor both want. */
  const backupCodesText = useMemo(() => backupCodes.join("\n"), [backupCodes]);

  /**
   * Save the codes as a text file.
   *
   * Built from a Blob rather than a `data:` URI: `img-src` in the CSP has no
   * `data:`, and while a download anchor is not covered by that directive
   * today, a blob URL is the shape that stays working if it ever is. It also
   * avoids putting the codes in the URL bar, where they would land in history.
   */
  const downloadBackupCodes = useCallback(() => {
    const blob = new Blob(
      [
        `Backup codes\n`,
        `Each code works once, in place of your authenticator code.\n`,
        `Generated ${new Date().toISOString()}\n\n`,
        `${backupCodesText}\n`,
      ],
      { type: "text/plain" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "backup-codes.txt";
    anchor.click();
    // Released immediately: the browser has already read the blob by the time
    // click() returns, and an un-revoked object URL pins the codes in memory
    // for the lifetime of the document.
    URL.revokeObjectURL(url);
  }, [backupCodesText]);

  const createPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      await setAccountPassword(newPassword);
      setHasPassword(true);
      setNewPassword("");
      setSuccessMessage(
        "Password set. Enter it below to create your authenticator secret."
      );
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

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
        <div className="space-y-5">
          {/* Said before the codes are shown, not after. This screen is the one
              chance to store them, and "you should have saved those" is not a
              recoverable state — the alternative is a support ticket to reset
              the second factor. */}
          <Alert variant="warning">
            <AlertTitle>Save these now — they are shown once</AlertTitle>
            <AlertDescription>
              Closing this page without storing them means starting setup again.
              Put them in a password manager rather than a screenshot: a picture
              of these is a working second factor, and it usually syncs to a
              cloud photo library.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <p className="text-sm font-medium">1. Scan with your authenticator</p>
            <div className="flex justify-center rounded-md border border-border bg-white p-4">
              <QrCode
                value={totpURI}
                size={200}
                label="Two-factor setup QR code"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              1Password, Google Authenticator, Authy, or your phone&apos;s
              built-in password manager will all read this.
            </p>
          </div>

          {/* Collapsed by default. Scanning is the path that works for almost
              everyone, and putting the raw secret on screen beside the QR
              invites people to copy the credential when they did not need to
              see it at all. */}
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Can&apos;t scan? Enter the key by hand
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Setup key — choose &ldquo;enter a setup key&rdquo; in your app,
                  with type &ldquo;time based&rdquo;.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                    {totpSecret ?? totpURI}
                  </code>
                  <CopyButton
                    value={totpSecret ?? totpURI}
                    ariaLabel="Copy setup key"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Full <code>otpauth://</code> URI — some password managers take
                  this directly.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                    {totpURI}
                  </code>
                  <CopyButton value={totpURI} ariaLabel="Copy authenticator URI" />
                </div>
              </div>
            </div>
          </details>

          {backupCodes.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">2. Store your backup codes</p>
                <div className="flex gap-2">
                  <CopyButton
                    value={backupCodesText}
                    label="Copy all"
                    ariaLabel="Copy all backup codes"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={downloadBackupCodes}
                  >
                    <Download className="mr-1 h-4 w-4" aria-hidden />
                    Download
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                {backupCodes.map((backupCode) => (
                  <code
                    key={backupCode}
                    className="rounded bg-muted px-2 py-1 font-mono text-xs"
                  >
                    {backupCode}
                  </code>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Each one works once, in place of a six-digit code, if you lose
                your phone. Keep them somewhere other than that phone.
              </p>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={verifySetup}>
            <Field
              label="3. Enter the code your app shows"
              description="Six digits, refreshed every 30 seconds."
              required
            >
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
      ) : !hasPassword ? (
        /**
         * The provider-only path. Asking this account to confirm a password it
         * has never had is unanswerable, so the form offers to create one
         * instead — which is also the only way such a user can ever satisfy the
         * admin console's two-factor requirement.
         */
        <form className="space-y-4" onSubmit={createPassword}>
          <Alert role="status">
            <AlertTitle>Set a password first</AlertTitle>
            <AlertDescription>
              You signed up with{" "}
              {socialProvider ? (
                <span className="capitalize">{socialProvider}</span>
              ) : (
                "a sign-in provider"
              )}
              , so this account has no password yet. Two-factor setup needs one.
              You can keep signing in with{" "}
              {socialProvider ? (
                <span className="capitalize">{socialProvider}</span>
              ) : (
                "your provider"
              )}{" "}
              afterwards.
            </AlertDescription>
          </Alert>
          <Field
            label="New password"
            description="At least 8 characters."
            required
          >
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                required
              />
            )}
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Set password"}
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
