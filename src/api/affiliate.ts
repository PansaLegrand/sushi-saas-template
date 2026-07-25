import { api } from "@/lib/api/client";

export function ensureInviteCode(options?: { regenerate?: boolean }) {
  return api.post<{ inviteCode?: string; shareUrl?: string }>(
    "/api/affiliate/invite-code",
    options?.regenerate ? { query: { regen: 1 } } : undefined
  );
}
