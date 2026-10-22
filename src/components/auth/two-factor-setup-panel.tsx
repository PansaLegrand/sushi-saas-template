"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  requiredForAdmin?: boolean;
  passwordManagedElsewhere?: boolean;
  onChanged?: () => Promise<void>;
}

export function TwoFactorSetupPanel({
  initialEnabled,
  initialHasPassword,
  providers = [],
  requiredForAdmin = false,
  passwordManagedElsewhere = false,
  onChanged,
}: TwoFactorSetupPanelProps) {
  const locale = useLocale();
  const t = useTranslations("auth.twoFactorSetup");

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

  useEffect(() => { setHasPassword(initialHasPassword); }, [initialHasPassword]);
  useEffect(() => { setEnabled(initialEnabled); if (initialEnabled) { setTotpURI(null); setCode(""); } }, [initialEnabled]);

  const socialProvider = providers.find(
    (provider) => provider !== "credential",
  );

  const totpSecret = useMemo(
    () => (totpURI ? extractTotpSecret(totpURI) : null),
    [totpURI],
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
        `${t("backupFileTitle")}\n`,
        `${t("backupFileHelp")}\n`,
        `${t("generated", { date: new Date().toISOString() })}\n\n`,
        `${backupCodesText}\n`,
      ],
      { type: "text/plain" },
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
  }, [backupCodesText, t]);

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
        t("passwordSet"),
      );
      await onChanged?.();
    } catch (error) {
      setErrorMessage(resolveErrorMessage(error, locale));
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
        method: "totp",
      });

      if (error) {
        setErrorMessage(resolveAuthError(error, locale));
        return;
      }

      if (data.method !== "totp") {
        setErrorMessage(resolveAuthError(null, locale));
        return;
      }

      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
      setSuccessMessage(
        t("addAuthenticator"),
      );
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
      setSuccessMessage(
        t("enabledSuccess"),
      );
      await onChanged?.();
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
      setSuccessMessage(t("disabledSuccess"));
      await onChanged?.();
    } catch {
      setErrorMessage(resolveAuthError(null, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {requiredForAdmin ? t("adminDescription") : t("description")}
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
        <span>{t("label")}</span>
        <span className={enabled ? "text-success" : "text-muted-foreground"}>
          {enabled ? t("enabled") : t("disabled")}
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
            <AlertTitle>{t("saveCodesTitle")}</AlertTitle>
            <AlertDescription>
              {t("saveCodesDescription")}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <p className="text-sm font-medium">
              {t("scanTitle")}
            </p>
            <div className="flex justify-center rounded-md border border-border bg-qr-background p-4">
              <QrCode
                value={totpURI}
                size={200}
                label={t("qrLabel")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("authenticatorHelp")}
            </p>
          </div>

          {/* Collapsed by default. Scanning is the path that works for almost
              everyone, and putting the raw secret on screen beside the QR
              invites people to copy the credential when they did not need to
              see it at all. */}
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("manualTitle")}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t("keyHelp")}
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                    {totpSecret ?? totpURI}
                  </code>
                  <CopyButton
                    value={totpSecret ?? totpURI}
                    ariaLabel={t("copyKey")}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t("uriHelp")}
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                    {totpURI}
                  </code>
                  <CopyButton
                    value={totpURI}
                    ariaLabel={t("copyUri")}
                  />
                </div>
              </div>
            </div>
          </details>

          {backupCodes.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {t("backupTitle")}
                </p>
                <div className="flex gap-2">
                  <CopyButton
                    value={backupCodesText}
                    label={t("copyAll")}
                    ariaLabel={t("copyAllCodes")}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={downloadBackupCodes}
                  >
                    <Download className="mr-1 h-4 w-4" aria-hidden />
                    {t("download")}
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
                {t("backupHelp")}
              </p>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={verifySetup}>
            <Field
              label={t("verifyLabel")}
              description={t("verifyHelp")}
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
              {isSubmitting ? t("verifying") : t("verifyEnable")}
            </Button>
          </form>
        </div>
      ) : !hasPassword && passwordManagedElsewhere ? (
        <Alert><AlertDescription>{t("passwordAbove")}</AlertDescription></Alert>
      ) : enabled ? (
        <form className="space-y-4" onSubmit={disable}>
          <Field label={t("password")} required>
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
            {isSubmitting ? t("disabling") : t("disable")}
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
            <AlertTitle>{t("setPasswordFirst")}</AlertTitle>
            <AlertDescription>
              {t.rich("providerDescription", { first: socialProvider ?? t("providerFallback"), second: socialProvider ?? t("yourProvider"), provider: (chunks) => <span className="capitalize">{chunks}</span> })}
            </AlertDescription>
          </Alert>
          <Field
            label={t("newPassword")}
            description={t("passwordLength")}
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
            {isSubmitting ? t("saving") : t("setPassword")}
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={startSetup}>
          <Field
            label={t("password")}
            description={t("confirmPassword")}
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
            {isSubmitting ? t("starting") : t("enable")}
          </Button>
        </form>
      )}
    </section>
  );
}

export default TwoFactorSetupPanel;
