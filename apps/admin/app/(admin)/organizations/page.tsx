import Link from "next/link";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import { Pager } from "@admin/components/pager";
import {
  countOrganizationsForAdmin,
  listOrganizationsForAdmin,
} from "@/models/organization";

/**
 * Organizations — the tenant, and the thing billing actually attaches to.
 *
 * Until this page, every admin billing surface resolved
 * `findPersonalOrganizationByUserUuid`, so the console could only ever see a
 * user's personal workspace. Since tenancy shipped, credits pool at the
 * organization and the Stripe customer belongs to it — meaning a team's balance,
 * plan, and subscription were **invisible to the operator**, with no error to
 * indicate anything was missing.
 *
 * The user-centric panels on the overview still exist and still act on the
 * personal workspace; they now say so rather than implying they cover everything.
 */

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) return null;

  const { q, page: rawPage } = await searchParams;
  const query = q?.trim() || undefined;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);
  const limit = 50;

  const [orgs, total] = await Promise.all([
    listOrganizationsForAdmin({ query, page, limit }),
    countOrganizationsForAdmin(query),
  ]);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Organizations"
        description="Credits, plans, and Stripe customers belong here — not to a user."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total}</p>
        }
      />

      {/* A GET form, so a search is a URL an operator can paste into a ticket. */}
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Name, slug, uuid, or cus_… "
          className="w-full max-w-md rounded border bg-background px-3 py-2 text-sm"
          aria-label="Search organizations"
        />
        <button type="submit" className="rounded border px-3 py-2 text-sm">
          Search
        </button>
        {query && (
          <Link
            href="/organizations"
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
              <th className="py-2 pl-3 pr-4">Name</th>
              <th className="py-2 pr-4">Slug</th>
              <th className="py-2 pr-4">Kind</th>
              <th className="py-2 pr-4">Members</th>
              <th className="py-2 pr-4">Stripe customer</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  No organizations{query ? ` matching "${query}"` : ""}.
                </td>
              </tr>
            )}
            {orgs.map((org) => (
              <tr key={org.uuid} className="border-t">
                <td className="py-2 pl-3 pr-4">{org.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{org.slug}</td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {org.is_personal ? "personal" : "team"}
                </td>
                <td className="py-2 pr-4">{org.member_count}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {org.stripe_customer_id ?? "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {org.created_at?.toISOString() ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/organizations/${org.uuid}`}
                    className="underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={limit}
        total={total}
        unit="organizations"
        href={(target) =>
          `/organizations?${query ? `q=${encodeURIComponent(query)}&` : ""}page=${target}`
        }
      />
    </div>
  );
}
