import { api } from "@/lib/api/client";

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
