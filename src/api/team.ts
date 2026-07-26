import { api } from "@/lib/api/client";
import type { InvitationView, MemberView, TeamView } from "@/types/team";

export type { InvitationView, MemberView, TeamView };

export function getTeam(signal?: AbortSignal) {
  return api.get<TeamView>("/api/account/team", { signal });
}

export function inviteMember(email: string, role: string) {
  return api.post<TeamView>("/api/account/team/invitations", {
    body: { email, role },
  });
}

export function cancelInvitation(id: string) {
  return api.delete<TeamView>(`/api/account/team/invitations/${id}`);
}

export function changeMemberRole(memberId: string, role: string) {
  return api.patch<TeamView>(`/api/account/team/members/${memberId}`, {
    body: { role },
  });
}

/** Removing someone else returns the new team; leaving returns `{ left: true }`. */
export function removeMember(memberId: string) {
  return api.delete<TeamView | { left: true }>(
    `/api/account/team/members/${memberId}`
  );
}

export function acceptInvitation(id: string) {
  return api.post<{ organizationId: string | null }>(
    `/api/account/invitations/${id}`
  );
}

export function declineInvitation(id: string) {
  return api.delete<{ declined: true }>(`/api/account/invitations/${id}`);
}
