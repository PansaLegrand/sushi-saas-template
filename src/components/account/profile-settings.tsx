"use client";
import { useCallback, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getAccountSettings, revokeAccountSessions, updateAccountName } from "@/api/account";
import { TwoFactorSetupPanel } from "@/components/auth/two-factor-setup-panel";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/errors/error-banner";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";
import { localePath } from "@/i18n/locale";
import type { AccountSettingsView, SessionRevocation } from "@/types/account";
import { PasswordSettings } from "./password-settings";
import { useAccountTime } from "./use-account-time";

function deviceName(agent: string | null) {
  if (!agent) return null;
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "";
  const platform = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return [browser, platform].filter(Boolean).join(" · ") || null;
}

export function ProfileSettings({ initial }: { initial: AccountSettingsView }) {
  const t = useTranslations("account.settings");
  const locale = useLocale();
  const date = useAccountTime();
  const [settings, setSettings] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [revocation, setRevocation] = useState<SessionRevocation | null>(null);
  const fail = useCallback((cause: unknown) => {
    setError(resolveErrorMessage(cause, locale));
    setReauth(isClientApiError(cause) && ["AUTH_REAUTHENTICATION_REQUIRED", "AUTH_REQUIRED"].includes(cause.code));
  }, [locale]);
  const refresh = useCallback(async () => {
    try { setSettings(await getAccountSettings()); } catch (cause) { fail(cause); }
  }, [fail]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try { const next = await updateAccountName(name); setSettings(next); setName(next.name); setNotice(t("profileSaved")); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function revoke() {
    if (!revocation) return;
    setBusy(true); setError(null); setNotice(null);
    try { setSettings(await revokeAccountSessions(revocation)); setNotice(t("sessionsSaved")); }
    catch (cause) { fail(cause); } finally { setRevocation(null); setBusy(false); }
  }
  return <div className="space-y-6">
    {error ? <ErrorBanner title={t("errorTitle")} message={error} action={reauth ? <Button asChild variant="outline"><a href={`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/account/profile"))}`}>{t("signInAgain")}</a></Button> : undefined} /> : null}
    {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>{t("profileTitle")}</CardTitle></CardHeader><CardContent><form onSubmit={save} className="grid gap-4">
      <Field label={t("name")} required>{(field) => <Input {...field} autoComplete="name" maxLength={100} value={name} onChange={(event) => setName(event.currentTarget.value)} required />}</Field>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span>{settings.email}</span><Badge variant="secondary">{settings.emailVerified ? t("verified") : t("unverified")}</Badge></div>
      <Button disabled={busy || !name.trim() || name.trim() === settings.name}>{busy ? t("saving") : t("save")}</Button>
    </form></CardContent></Card>
    <PasswordSettings hasPassword={settings.hasPassword} onChanged={refresh} />
    <TwoFactorSetupPanel key={settings.userUuid} initialEnabled={settings.twoFactorEnabled} initialHasPassword={settings.hasPassword} providers={settings.providers} requiredForAdmin={settings.mfaRequired} passwordManagedElsewhere onChanged={refresh} />
    <Card><CardHeader><CardTitle>{t("sessionsTitle")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("sessionsDescription")}</p>
      <ul className="divide-y divide-border">{settings.sessions.map((session) => <li key={session.reference} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="space-y-1"><p className="text-sm font-medium">{deviceName(session.userAgent) ?? t("unknownDevice")} {session.current ? <Badge variant="secondary">{t("thisDevice")}</Badge> : null}</p><p className="text-xs text-muted-foreground">{t("created", { date: date(session.createdAt) })}</p></div>
        <Button variant="outline" size="sm" disabled={busy || session.current} onClick={() => setRevocation({ scope: "session", reference: session.reference })}>{t("signOut")}</Button>
      </li>)}</ul>
      <Button variant="outline" disabled={busy || !settings.sessions.some((session) => !session.current)} onClick={() => setRevocation({ scope: "others" })}>{t("signOutOthers")}</Button>
    </CardContent></Card>
    <Dialog open={Boolean(revocation)} onOpenChange={(open) => { if (!open && !busy) setRevocation(null); }}><DialogContent><DialogHeader><DialogTitle>{t("signOutTitle")}</DialogTitle><DialogDescription>{t("signOutDescription")}</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy} onClick={() => void revoke()}>{t("confirmSignOut")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
