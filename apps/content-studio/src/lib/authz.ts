import type { Access, PayloadRequest } from "payload";

export const editorRoles = [
  "writer",
  "seo-manager",
  "reviewer",
  "publisher",
  "admin"
] as const;

export const automationScopes = [
  "content:read",
  "content:draft:create",
  "content:draft:update",
  "content:submit",
  "content:publish",
  "marketing:read",
  "marketing:draft:create",
  "marketing:draft:update",
  "marketing:test",
  "marketing:send",
  "jobs:read"
] as const;

export type EditorRole = (typeof editorRoles)[number];
export type AutomationScope = (typeof automationScopes)[number];

type AuthIdentity = {
  collection?: string;
  role?: EditorRole;
  scopes?: AutomationScope[] | null;
  expiresAt?: string | null;
};

function identity(req: Pick<PayloadRequest, "user">): AuthIdentity | null {
  return (req.user as AuthIdentity | null) ?? null;
}

export function isStudioUser(req: Pick<PayloadRequest, "user">): boolean {
  return identity(req)?.collection === "users";
}

export function hasEditorRole(
  req: Pick<PayloadRequest, "user">,
  roles: readonly EditorRole[]
): boolean {
  const user = identity(req);
  return user?.collection === "users" && Boolean(user.role && roles.includes(user.role));
}

export function hasAutomationScope(
  req: Pick<PayloadRequest, "user">,
  scope: AutomationScope
): boolean {
  const user = identity(req);
  if (user?.collection === "users") return user.role === "admin";
  if (user?.collection !== "service-accounts") return false;
  if (user.expiresAt && Date.parse(user.expiresAt) <= Date.now()) return false;
  return Boolean(user.scopes?.includes(scope));
}

export function canPublish(req: Pick<PayloadRequest, "user">): boolean {
  return (
    hasEditorRole(req, ["publisher", "admin"]) ||
    hasAutomationScope(req, "content:publish")
  );
}

export function canSubmit(req: Pick<PayloadRequest, "user">): boolean {
  return isStudioUser(req) || hasAutomationScope(req, "content:submit");
}

export const contentEditors: Access = ({ req }) => isStudioUser(req);

export const publishersAndAdmins: Access = ({ req }) =>
  hasEditorRole(req, ["publisher", "admin"]);

export const adminsOnly: Access = ({ req }) => hasEditorRole(req, ["admin"]);

export function studioUsersOrAutomation(scope: AutomationScope): Access {
  return ({ req }) => isStudioUser(req) || hasAutomationScope(req, scope);
}

export const studioUsersOrPublished: Access = ({ req }) => {
  if (isStudioUser(req)) return true;
  return { _status: { equals: "published" } };
};

export function requireScope(
  req: Pick<PayloadRequest, "user">,
  scope: AutomationScope
): Response | null {
  if (hasAutomationScope(req, scope)) return null;
  return Response.json(
    {
      error: {
        code: "CONTENT_SCOPE_REQUIRED",
        message: `This operation requires the ${scope} scope.`
      }
    },
    { status: req.user ? 403 : 401 }
  );
}
