"use client";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setAccountPassword } from "@/api/account";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";
import { localePath } from "@/i18n/locale";
import { authClient } from "@/lib/auth-client";
import { resolveAuthError } from "@/lib/errors/auth-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function PasswordSettings({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => Promise<void> }) {
  const t = useTranslations("account.settings");
  const locale = useLocale();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSaved(null);
    try {
      if (hasPassword) {
        const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
        if (result.error) { setError(resolveAuthError(result.error, locale)); setReauth(result.error.status === 401); return; }
      } else await setAccountPassword(newPassword);
      setCurrent(""); setNew(""); setSaved(t(hasPassword ? "passwordSaved" : "passwordCreated")); await onChanged();
    } catch (cause) {
      setError(isClientApiError(cause) ? resolveErrorMessage(cause, locale) : resolveAuthError(null, locale));
      setReauth(isClientApiError(cause) && cause.code === "AUTH_REAUTHENTICATION_REQUIRED");
    }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>{t(hasPassword ? "passwordTitle" : "setPassword")}</CardTitle></CardHeader><CardContent>
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t(hasPassword ? "passwordDescription" : "setPasswordDescription")}</p>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {saved ? <Alert variant="success" role="status"><AlertDescription>{saved}</AlertDescription></Alert> : null}
      {hasPassword ? <Field label={t("currentPassword")} required>{(field) => <Input {...field} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrent(event.currentTarget.value)} required />}</Field> : null}
      <Field label={t("newPassword")} required>{(field) => <Input {...field} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNew(event.currentTarget.value)} required />}</Field>
      {reauth ? <a className="text-sm underline" href={`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/account/profile"))}`}>{t("signInAgain")}</a> : null}
      <Button disabled={busy || (hasPassword && !currentPassword) || newPassword.length < 8}>{busy ? t("saving") : t(hasPassword ? "changePassword" : "setPassword")}</Button>
    </form>
  </CardContent></Card>;
}
