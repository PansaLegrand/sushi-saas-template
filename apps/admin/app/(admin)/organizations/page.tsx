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
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-6">
      <AdminPageHeader
        title="Organizations"
        description="Credits, plans, and Stripe customers belong here — not to a user."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total}</p>
        }
      />

      {/* GET keeps the result URL shareable in support tickets. */}
      <AdminSearchToolbar
        defaultValue={query}
        placeholder="Name, slug, UUID, or cus_…"
        ariaLabel="Search organizations"
        clearHref="/organizations"
      />

      <AdminTable caption="Organizations" className="min-w-[68rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Name</AdminTableHead>
            <AdminTableHead>Slug</AdminTableHead>
            <AdminTableHead>Kind</AdminTableHead>
            <AdminTableHead>Members</AdminTableHead>
            <AdminTableHead>Stripe customer</AdminTableHead>
            <AdminTableHead>Created</AdminTableHead>
            <AdminTableHead>
              <span className="sr-only">Actions</span>
            </AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {orgs.length === 0 && (
            <AdminTableEmpty
              colSpan={7}
              title={
                query ? "No matching organizations" : "No organizations yet"
              }
              description={
                query
                  ? `Nothing matched “${query}”. Try another identifier.`
                  : undefined
              }
            />
          )}
          {orgs.map((org) => (
            <AdminTableRow key={org.uuid}>
              <AdminTableCell className="font-medium">
                {org.name}
              </AdminTableCell>
              <AdminTableCell className="font-mono">{org.slug}</AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge tone={org.is_personal ? "neutral" : "info"}>
                  {org.is_personal ? "Personal" : "Team"}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="tabular-nums">
                {org.member_count}
              </AdminTableCell>
              <AdminTableCell className="font-mono">
                {org.stripe_customer_id ?? "—"}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(org.created_at)}
              </AdminTableCell>
              <AdminTableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/organizations/${org.uuid}`}>Open</Link>
                </Button>
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

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
