import type { OrgRoleName } from "./team";

/** Browser-safe workspace data rendered by the account shell. */
export interface OrgWorkspaceView {
  slug: string;
  name: string;
  isPersonal: boolean;
  role: OrgRoleName;
}

export interface OrgNavigationView {
  current: {
    orgSlug: string;
    orgName: string;
    role: OrgRoleName;
  };
  workspaces: OrgWorkspaceView[];
}
