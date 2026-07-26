/**
 * The team screen's wire types.
 *
 * Declared here rather than imported from `@/services/members` because
 * `src/api/` runs in the browser and must not reach into the service layer —
 * doing so drags the database driver and `server-only` into the client bundle.
 * The architecture test enforces it.
 */

export type OrgRoleName = "owner" | "admin" | "member";

export interface MemberView {
  memberId: string;
  userUuid: string;
  email: string;
  name: string;
  role: OrgRoleName;
  joinedAt: string | null;
  /** True for the row describing the viewer, so the UI can label and guard it. */
  isSelf: boolean;
}

export interface InvitationView {
  id: string;
  email: string;
  role: string | null;
  expiresAt: string | null;
}

export interface TeamView {
  organization: {
    uuid: string;
    name: string;
    slug: string;
    /** A personal workspace cannot be left, and inviting into it makes it a team. */
    isPersonal: boolean;
  };
  viewer: { role: OrgRoleName; canManage: boolean };
  members: MemberView[];
  /** Empty for members who cannot manage them, not merely hidden by the UI. */
  invitations: InvitationView[];
}
