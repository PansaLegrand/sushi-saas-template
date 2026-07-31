import Link from "next/link";

import { AdminHelp } from "@admin/components/admin-help";
import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminBannedUsers, listAdminBannedUsers } from "@admin/lib/data";
import BanUserPanel from "@admin/components/ban-user";
import EmailBlocklistPanel from "@admin/components/email-blocklist";
import { Pager } from "@admin/components/pager";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    <div className="space-y-8">
      <AdminPageHeader
        title="Moderation"
        description="Suspend abusive accounts, revoke their sessions, and stop repeat signups."
        actions={
          <p className="text-sm text-muted-foreground">{total} suspended</p>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Suspend an account</CardTitle>
            <CardDescription>
              Search users by email, UUID, or nickname when you need the account
              identifier.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <BanUserPanel canWrite={!!canWrite} />
            <p className="text-sm text-muted-foreground">
              Need an identifier?{" "}
              <Link
                href="/users"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Search users
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <AdminHelp summary="What suspension changes">
          Suspending an account blocks sign-in and kills every live session. It
          deliberately leaves the row, the credit ledger, and the uploads alone:
          during an abuse wave the account is the evidence, and deleting it
          frees the address to register again. Erasing someone&apos;s data is a
          separate operation with a separate policy behind it, and it is not
          here.
        </AdminHelp>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signup blocklist</CardTitle>
          <CardDescription>
            Stop individual addresses or entire disposable-email domains before
            account creation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <EmailBlocklistPanel canWrite={!!canWrite} />
          <AdminHelp summary="How address matching works">
            Rules apply to email and OAuth signups. Addresses are normalized
            before matching: <code>+suffix</code> is removed everywhere and dots
            are removed for Gmail. A domain rule is the fastest response to a
            disposable-mail flood.
          </AdminHelp>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suspended accounts</CardTitle>
          <CardDescription>
            Active restrictions and the operator context behind each decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>User UUID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Suspended</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Operator</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {banned.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={6}>
                    Nobody is suspended.
                  </TableCell>
                </TableRow>
              ) : (
                banned.map((user) => (
                  <TableRow key={user.uuid} className="align-top">
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {user.uuid}
                    </TableCell>
                    <TableCell>{user.signin_provider || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {user.banned_at ? user.banned_at.toISOString() : "—"}
                    </TableCell>
                    <TableCell>{user.ban_reason || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {user.banned_by || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            unit="accounts"
            href={(target) => `/moderation?page=${target}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
