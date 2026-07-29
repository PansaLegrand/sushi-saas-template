import Link from "next/link";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminBannedUsers, listAdminBannedUsers } from "@admin/lib/data";
import BanUserPanel from "@admin/components/ban-user";
import EmailBlocklistPanel from "@admin/components/email-blocklist";
import { Pager } from "@admin/components/pager";

const PAGE_SIZE = 50;

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await getAdminContext();
  // Layout already guards; this is a type-safety fallback.
  const canWrite = admin?.role === "admin_rw";

  const { page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  // Counted rather than measured from the page. `banned.length` pins at the page
  // size, so a wave that suspended four hundred accounts reported fifty — during
  // the incident where "how many did we catch" is the question being asked.
  const [banned, total] = await Promise.all([
    listAdminBannedUsers(page, PAGE_SIZE),
    countAdminBannedUsers(),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <AdminPageHeader
        title="Moderation"
        description="Suspend abusive accounts, revoke their sessions, and stop repeat signups."
        actions={
          <p className="text-sm text-muted-foreground">{total} suspended</p>
        }
      />

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-medium">How suspension works</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Suspending an account blocks sign-in and kills every live session. It
          deliberately leaves the row, the credit ledger, and the uploads alone:
          during an abuse wave the account is the evidence, and deleting it
          frees the address to register again. Erasing someone&apos;s data is a
          separate operation with a separate policy behind it, and it is not
          here.
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Suspend an account</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Find the user&apos;s UUID by{" "}
          <Link href="/users" className="underline">
            searching users
          </Link>{" "}
          — by address, uuid, or nickname.
        </p>
        <BanUserPanel canWrite={!!canWrite} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Signup blocklist</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Checked on every signup, including OAuth. Addresses are matched in a
          normalized form — <code>+suffix</code> stripped everywhere, dots
          stripped for Gmail — so one rule covers the alias cycling that beats a
          literal match. Blocking a whole domain is the fastest way to end a
          flood from a disposable-mail provider.
        </p>
        <EmailBlocklistPanel canWrite={!!canWrite} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">
          Suspended accounts ({total})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">UUID</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Suspended</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">By</th>
              </tr>
            </thead>
            <tbody>
              {banned.length === 0 && (
                <tr>
                  <td className="py-3 text-muted-foreground" colSpan={6}>
                    Nobody is suspended.
                  </td>
                </tr>
              )}
              {banned.map((user) => (
                <tr key={user.uuid} className="border-t align-top">
                  <td className="py-2 pr-4">{user.email}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{user.uuid}</td>
                  <td className="py-2 pr-4">{user.signin_provider || "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {user.banned_at ? user.banned_at.toISOString() : "—"}
                  </td>
                  <td className="py-2 pr-4">{user.ban_reason || "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {user.banned_by || "—"}
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
          unit="accounts"
          href={(target) => `/moderation?page=${target}`}
        />
      </section>
    </div>
  );
}
