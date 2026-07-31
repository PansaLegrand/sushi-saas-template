import Link from "next/link";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import {
  AdminTable,
  AdminTableBody,
  AdminTableCell,
  AdminTableEmpty,
  AdminTableHead,
  AdminTableHeader,
  AdminTableRow,
} from "@admin/components/admin-table";
import { AdminSearchToolbar } from "@admin/components/admin-toolbar";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminUsers, listAdminUsers } from "@admin/lib/data";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";

/**
 * Users — finding the one you came here about.
 *
 * Until this page the console could list the newest twenty accounts and nothing
 * else. Every write tool it offers — grant credits, comp a plan, suspend — is
 * keyed on a `uuid`, and the only instruction for obtaining one was "find it on
 * the overview". For any account outside that twenty, that resolved to opening
 * Postgres. The moderation panel was the sharp case: the page built to end an
 * abuse wave could not locate the abuser.
 *
 * So this page has one job, and it is search. Columns are the ones an operator
 * needs to confirm they have the right person and to act — the address, the uuid
 * to paste, the provider, and whether the account is already suspended. The
 * sensitive columns stay behind the allowlist in `apps/admin/lib/data.ts`.
 */

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  // Layout already guards; this is a type-safety fallback.
  const admin = await getAdminContext();
  if (!admin) return null;

  const { q, page: rawPage } = await searchParams;
  const query = q?.trim() || undefined;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [rows, total] = await Promise.all([
    listAdminUsers({ query, page, limit: PAGE_SIZE }),
    countAdminUsers(query),
  ]);

  const pageHref = (target: number) =>
    `/users?${query ? `q=${encodeURIComponent(query)}&` : ""}page=${target}`;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users"
        description={
          <p>
            An account, not a tenant. Credits and plans pool at the{" "}
            <Link href="/organizations" className="underline">
              organization
            </Link>
            .
          </p>
        }
        actions={
          <p className="text-sm text-muted-foreground">
            {query ? `Matching: ${total}` : `Total: ${total}`}
          </p>
        }
      />

      {/* GET keeps the result URL shareable in support tickets. */}
      <AdminSearchToolbar
        defaultValue={query}
        placeholder="Email, UUID, or nickname"
        ariaLabel="Search users"
        clearHref="/users"
      />

      <AdminTable caption="User accounts" className="min-w-[72rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Email</AdminTableHead>
            <AdminTableHead>UUID</AdminTableHead>
            <AdminTableHead>Provider</AdminTableHead>
            <AdminTableHead>Role</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Created</AdminTableHead>
            <AdminTableHead>Last sign-in</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {rows.length === 0 && (
            <AdminTableEmpty
              colSpan={7}
              title={query ? "No matching users" : "No users yet"}
              description={
                query
                  ? `Nothing matched “${query}”. Try another identifier.`
                  : undefined
              }
            />
          )}
          {rows.map((user) => (
            <AdminTableRow key={user.id}>
              <AdminTableCell className="font-medium">
                {user.email}
              </AdminTableCell>
              {/* Every write tool takes this value, so keep it selectable. */}
              <AdminTableCell className="font-mono select-all">
                {user.uuid}
              </AdminTableCell>
              <AdminTableCell className="text-muted-foreground">
                {user.signin_provider || "—"}
              </AdminTableCell>
              <AdminTableCell>{user.role || "user"}</AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge tone={user.banned_at ? "danger" : "success"}>
                  {user.banned_at ? "Suspended" : "Active"}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(user.created_at)}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(user.last_signin_at)}
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="users"
        href={pageHref}
      />
    </div>
  );
}
