"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cancelAccountDeletion, getAccountDeletion, getDataExport, getLatestDataExport, requestAccountDeletion, requestDataExport } from "@/api/account";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/errors/error-banner";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";
import { localePath } from "@/i18n/locale";
import type { AccountExportView, PrivacyRequestView } from "@/types/account";
import { useAccountTime } from "./use-account-time";

function requestKey() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
export function PrivacySettings({ email, initialExport, initialDeletion, graceDays }: {
  email: string; initialExport: AccountExportView | null; initialDeletion: PrivacyRequestView | null; graceDays: number;
}) {
  const t = useTranslations("account.privacy");
  const locale = useLocale();
  const date = useAccountTime();
  const [exported, setExport] = useState(initialExport);
  const [deletion, setDeletion] = useState(initialDeletion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const mutating = useRef(false);
  const [reauth, setReauth] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [blockers, setBlockers] = useState<{ slug: string; name: string }[]>([]);
  const exportKey = useRef<string | null>(null);
  const deletionKey = useRef<string | null>(null);
  const pendingExport = Boolean(exported && ["scheduled", "processing", "retrying"].includes(exported.status));
  const exportUuid = exported?.uuid;
  const exportStatus = exported?.status;
  useEffect(() => {
    if (!exportUuid || !exportStatus || !["scheduled", "processing", "retrying"].includes(exportStatus)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      let again = true;
      try {
        if (document.visibilityState === "hidden") return;
        const latest = await getLatestDataExport(controller.signal);
        if (controller.signal.aborted) return;
        setExport(latest); setStatusError(null); failures = 0;
        again = Boolean(latest && ["scheduled", "processing", "retrying"].includes(latest.status));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setStatusError(resolveErrorMessage(cause, locale)); failures += 1;
          if (isClientApiError(cause) && cause.status === 401) { again = false; setReauth(true); }
        }
      } finally {
        if (!controller.signal.aborted && again) timer = setTimeout(poll, Math.min(30_000, 5_000 * 2 ** Math.min(failures, 3)));
      }
    }
    timer = setTimeout(poll, 1_000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [exportUuid, exportStatus, locale]);

  function fail(cause: unknown) {
    setError(resolveErrorMessage(cause, locale));
    setReauth(isClientApiError(cause) && ["AUTH_REAUTHENTICATION_REQUIRED", "AUTH_REQUIRED"].includes(cause.code));
    if (isClientApiError(cause) && cause.code === "ACCOUNT_DELETION_OWNER_TRANSFER_REQUIRED") {
      const entries = (cause.details as { organizations?: unknown })?.organizations;
      if (Array.isArray(entries)) setBlockers(entries.filter((entry) => typeof entry?.slug === "string" && typeof entry?.name === "string"));
      deletionKey.current = null;
    }
    if (isClientApiError(cause) && cause.code === "ACCOUNT_DELETION_ADMIN_CONTINUITY_REQUIRED") deletionKey.current = null;
  }
  async function createExport() {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true); setError(null); setNotice(null);
    exportKey.current ??= requestKey();
    try { setExport(await requestDataExport(exportKey.current)); exportKey.current = null; }
    catch (cause) { fail(cause); } finally { mutating.current = false; setBusy(false); }
  }
  async function downloadLinks() {
    if (!exported) return;
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true); setError(null);
    try { setExport(await getDataExport(exported.uuid)); }
    catch (cause) {
      if (isClientApiError(cause) && cause.code === "ACCOUNT_EXPORT_EXPIRED") setExport((current) => current ? { ...current, status: "expired", download: undefined } : null);
      fail(cause);
    } finally { mutating.current = false; setBusy(false); }
  }
  async function scheduleDeletion() {
    if (confirmation.trim().toLowerCase() !== email.toLowerCase()) return;
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true); setError(null); setBlockers([]); setNotice(null);
    deletionKey.current ??= requestKey();
    try { setDeletion(await requestAccountDeletion(deletionKey.current)); deletionKey.current = null; }
    catch (cause) { fail(cause); } finally { mutating.current = false; setBusy(false); setConfirm(false); setConfirmation(""); }
  }
  async function cancelDeletion() {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true); setError(null);
    try { await cancelAccountDeletion(); setDeletion(await getAccountDeletion()); setNotice(t("canceled")); }
    catch (cause) { fail(cause); } finally { mutating.current = false; setBusy(false); }
  }
  const status = (value: string) => t.has(`status.${value}`) ? t(`status.${value}`) : t("status.unknown");
  return <div className="space-y-6">
    {error || statusError ? <ErrorBanner title={t("errorTitle")} message={(error ?? statusError)!} action={reauth ? <Button asChild variant="outline"><a href={`${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(localePath(locale, "/account/privacy"))}`}>{t("signInAgain")}</a></Button> : undefined} /> : null}
    {blockers.length ? <Alert><AlertDescription>{t("transferHelp")} <ul className="mt-2 space-y-1">{blockers.map((org) => <li key={org.slug}><a className="underline" href={`${localePath(locale, "/account/team")}?org=${encodeURIComponent(org.slug)}`}>{org.name}</a></li>)}</ul></AlertDescription></Alert> : null}
    {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>{t("exportTitle")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("exportDescription")}</p>
      {exported ? <div aria-live="polite" className="space-y-2"><p>{status(exported.status)}</p>{exported.expiresAt ? <p className="text-sm text-muted-foreground">{t("expires", { date: date(exported.expiresAt) })}</p> : null}</div> : null}
      <div className="flex flex-wrap gap-3"><Button disabled={busy || pendingExport} onClick={() => void createExport()}>{pendingExport ? t("preparing") : t("createExport")}</Button>{exported?.status === "completed" ? <Button variant="outline" disabled={busy} onClick={() => void downloadLinks()}>{exported.download ? t("refreshLinks") : t("getLinks")}</Button> : null}</div>
      {exported?.download ? <div className="space-y-3"><Button asChild variant="outline"><a href={exported.download.manifest.url} target="_blank" rel="noopener noreferrer">{t("downloadManifest")}</a></Button><p className="text-sm text-muted-foreground">{t("linksExpire", { seconds: exported.download.manifest.expiresIn })}</p>{exported.download.files.length ? <details><summary className="cursor-pointer text-sm font-medium">{t("includedFiles", { count: exported.download.files.length })}</summary><ul className="mt-2 space-y-2">{exported.download.files.map((file) => <li key={file.uuid}><a className="text-sm underline" href={file.url} target="_blank" rel="noopener noreferrer">{file.filename}</a></li>)}</ul></details> : null}</div> : null}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t("deleteTitle")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("deleteDescription", { days: graceDays })}</p>
      {deletion && ["scheduled", "processing"].includes(deletion.status) ? <Alert variant="warning"><AlertDescription>{deletion.status === "scheduled" ? t("scheduled", { date: date(deletion.scheduledAt) }) : t("status.processing")}</AlertDescription></Alert> : null}
      {deletion?.status === "scheduled" ? <Button variant="outline" disabled={busy} onClick={() => void cancelDeletion()}>{t("cancelDeletion")}</Button> : <Button variant="destructive" disabled={busy || deletion?.status === "processing"} onClick={() => setConfirm(true)}>{t("deleteAction")}</Button>}
    </CardContent></Card>
    <Dialog open={confirm} onOpenChange={(open) => { if (!busy) setConfirm(open); }}><DialogContent><DialogHeader><DialogTitle>{t("confirmTitle")}</DialogTitle><DialogDescription>{t("confirmDescription", { email, days: graceDays })}</DialogDescription></DialogHeader>
      <Field label={t("confirmEmail")} required>{(field) => <Input {...field} type="email" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} />}</Field>
      <DialogFooter><DialogClose asChild><Button variant="outline" disabled={busy}>{t("cancel")}</Button></DialogClose><Button variant="destructive" disabled={busy || confirmation.trim().toLowerCase() !== email.toLowerCase()} onClick={() => void scheduleDeletion()}>{t("scheduleDeletion")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
