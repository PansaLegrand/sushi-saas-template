import Link from "next/link";

import { getAdminContext } from "@admin/lib/authz";
import { countAdminUsers, listAdminUsers } from "@admin/lib/data";
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
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            An account, not a tenant. Credits and plans pool at the{" "}
            <Link href="/organizations" className="underline">
              organization
            </Link>
            .
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {query ? `Matching: ${total}` : `Total: ${total}`}
        </p>
      </header>

      {/* A GET form, so a search is a URL an operator can paste into a ticket. */}
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Email, uuid, or nickname"
          className="w-full max-w-md rounded border bg-background px-3 py-2 text-sm"
          aria-label="Search users"
        />
        <button type="submit" className="rounded border px-3 py-2 text-sm">
          Search
        </button>
        {query && (
          <Link
            href="/users"
            className="self-center text-sm text-muted-foreground underline"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pl-3 pr-4">Email</th>
              <th className="py-2 pr-4">UUID</th>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  No users{query ? ` matching "${query}"` : ""}.
                </td>
              </tr>
            )}
            {rows.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="py-2 pl-3 pr-4">{user.email}</td>
                {/* The column the operator is here for: every write tool in the
                    console takes this value, so it stays selectable as one word. */}
                <td className="py-2 pr-4 font-mono text-xs select-all">
                  {user.uuid}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {user.signin_provider || "—"}
                </td>
                <td className="py-2 pr-4">{user.role || "user"}</td>
                <td className="py-2 pr-4">
                  {user.banned_at ? (
                    <span className="text-destructive">Suspended</span>
                  ) : (
                    "Active"
                  )}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {user.created_at?.toISOString() ?? "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {user.last_signin_at?.toISOString() ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
