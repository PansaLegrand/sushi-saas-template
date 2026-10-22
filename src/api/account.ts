import { api } from "@/lib/api/client";
import type { AccountExportView, AccountSettingsView, PrivacyRequestView, SessionRevocation } from "@/types/account";

export function getAccountSettings(signal?: AbortSignal) { return api.get<AccountSettingsView>("/api/account/settings", { signal, cache: "no-store" }); }
export function updateAccountName(name: string) { return api.patch<AccountSettingsView>("/api/account/profile", { body: { name } }); }
export function revokeAccountSessions(action: SessionRevocation) { return api.delete<AccountSettingsView>("/api/account/sessions", { body: action }); }
export function requestDataExport(key: string) { return api.post<PrivacyRequestView>("/api/account/data-export", { headers: { "Idempotency-Key": key } }); }
export function getDataExport(uuid: string, signal?: AbortSignal) { return api.get<AccountExportView>(`/api/account/data-export/${encodeURIComponent(uuid)}`, { signal, cache: "no-store" }); }
export function getLatestDataExport(signal?: AbortSignal) { return api.get<AccountExportView | null>("/api/account/data-export", { signal, cache: "no-store" }); }
export function getAccountDeletion(signal?: AbortSignal) { return api.get<PrivacyRequestView | null>("/api/account/deletion", { signal, cache: "no-store" }); }
export function requestAccountDeletion(key: string) { return api.post<PrivacyRequestView>("/api/account/deletion", { headers: { "Idempotency-Key": key } }); }
export function cancelAccountDeletion() { return api.delete<{ canceled: boolean }>("/api/account/deletion"); }

/**
 * Set a first password on a provider-only account.
 *
 * There is no `changePassword` companion here on purpose: rotating a known
 * password goes through Better Auth's own client, which re-authenticates. This
 * endpoint only fills in a password that was never set.
 */
export function setAccountPassword(newPassword: string) {
  return api.post<{ ok: true }>("/api/account/password", {
    body: { newPassword },
  });
}
