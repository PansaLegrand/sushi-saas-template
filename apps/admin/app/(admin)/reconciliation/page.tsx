import Link from "next/link";

import { AdminHelp } from "@admin/components/admin-help";
import { AdminPageHeader } from "@admin/components/admin-page-header";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import { getAdminContext } from "@admin/lib/authz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  reconcileLocalBilling,
  type ReconcileFinding,
} from "@/services/stripe/reconcile";

/**
 * Reconciliation: does what this database recorded match what it promised?
 *
 * The findings already existed — `pnpm reconcile:stripe --local-only` has
 * computed them since item 5 — and were reachable only by someone with a
 * checkout, a database URL, and a terminal. That is the wrong audience: the
 * person who needs to know a customer paid and got no credits is whoever is
 * reading the support ticket.
 *
 * **The local half only.** The Stripe half walks the invoice API, needs a live
 * secret key, and takes as long as the account is large — not something to hang
 * a page render on. It stays in the script, and the page says so rather than
 * implying this is the whole check.
 */

const DEFAULT_WINDOW_DAYS = 30;
const WINDOWS = [7, 30, 90] as const;
const FINDING_LIMIT = 100;

const KIND_COPY: Record<string, { title: string; what: string }> = {
  order_missing_credits: {
    title: "Paid orders with no credits",
    what: "The customer paid and the ledger has nothing. The most serious thing this check finds — grant the credits, then find out why fulfillment did not.",
  },
  ledger_balance_drift: {
    title: "Ledger balance drift",
    what: "A row's balance_after disagrees with the sum of the ledger before it, which means two writes raced. The balance shown to the customer may be wrong.",
  },
  stuck_event: {
    title: "Stuck webhook events",
    what: "Parked for a human, or failed past Stripe's retry window. Resolve or replay them from the events page.",
  },
};

export default async function AdminReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // Layout already guards; this is a type-safety fallback.
  const admin = await getAdminContext();
  if (!admin) return null;

  const { days: rawDays } = await searchParams;
  const parsedDays = Number.parseInt(rawDays ?? "", 10);
  const days = (WINDOWS as readonly number[]).includes(parsedDays)
    ? parsedDays
    : DEFAULT_WINDOW_DAYS;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const report = await reconcileLocalBilling({ since, limit: FINDING_LIMIT });

  const byKind = new Map<string, ReconcileFinding[]>();
  for (const finding of report.findings) {
    byKind.set(finding.kind, [...(byKind.get(finding.kind) ?? []), finding]);
  }

  const errors = report.findings.filter((f) => f.severity === "error").length;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Reconciliation"
        description="Compare local billing promises with the records that should prove them."
        actions={
          <nav
            aria-label="Reconciliation window"
            className="flex flex-wrap gap-2"
          >
            {WINDOWS.map((window) => (
              <Button
                key={window}
                asChild
                size="sm"
                variant={days === window ? "default" : "outline"}
              >
                <Link
                  href={`/reconciliation?days=${window}`}
                  aria-current={days === window ? "page" : undefined}
                >
                  {window} days
                </Link>
              </Button>
            ))}
          </nav>
        }
      />

      <Alert variant={report.ok ? "success" : "destructive"}>
        <AlertTitle>
          {report.ok ? "No billing errors found" : "Billing needs attention"}
        </AlertTitle>
        <AlertDescription>
          {report.ok ? (
            <>
              No error-severity findings since {report.since.slice(0, 10)}.
              {report.findings.length > 0
                ? ` ${report.findings.length} warning(s) remain for review.`
                : ""}
            </>
          ) : (
            <>
              {errors} error-severity finding{errors === 1 ? "" : "s"} since{" "}
              {report.since.slice(0, 10)}. Money and entitlement may disagree
              right now.
            </>
          )}
        </AlertDescription>
      </Alert>

      <AdminHelp summary="Scope and limitations of this report">
        This is the <strong>local</strong> half: it compares this database
        against itself and needs no Stripe key. It cannot detect &ldquo;Stripe
        charged them and we were never told&rdquo; — that requires walking the
        invoice API, which stays in <code>pnpm reconcile:stripe</code>. Findings
        are capped at {FINDING_LIMIT} per check.
      </AdminHelp>

      {report.findings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-base text-muted-foreground">
            No findings in the last {days} days.
          </CardContent>
        </Card>
      )}

      {[...byKind.entries()].map(([kind, findings]) => {
        const copy = KIND_COPY[kind];

        return (
          <Card key={kind}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1.5">
                <CardTitle>{copy?.title ?? kind}</CardTitle>
                <CardDescription>
                  {copy?.what ?? "See the detail below."}
                </CardDescription>
              </div>
              <AdminStatusBadge
                tone={
                  findings.some((finding) => finding.severity === "error")
                    ? "danger"
                    : "warning"
                }
              >
                {findings.length}
              </AdminStatusBadge>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((finding, index) => (
                    <TableRow key={`${kind}-${index}`} className="align-top">
                      <TableCell>
                        <AdminStatusBadge
                          tone={
                            finding.severity === "error" ? "danger" : "warning"
                          }
                        >
                          {finding.severity}
                        </AdminStatusBadge>
                      </TableCell>
                      <TableCell>
                        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                          {Object.entries(finding.detail).map(
                            ([key, value]) => (
                              <div key={key} className="space-y-1">
                                <dt className="text-sm font-medium text-muted-foreground">
                                  {key}
                                </dt>
                                <dd className="break-all font-mono text-sm">
                                  {value === null || value === undefined
                                    ? "—"
                                    : String(value)}
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {kind === "order_missing_credits" && (
                <p className="text-sm text-muted-foreground">
                  Each of these is one row in{" "}
                  <Link
                    href="/orders?status=paid"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Orders
                  </Link>{" "}
                  showing <span className="text-destructive">none</span>{" "}
                  granted.
                </p>
              )}
              {kind === "stuck_event" && (
                <p className="text-sm text-muted-foreground">
                  Act on these from{" "}
                  <Link
                    href="/stripe-events?status=action_required"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Stripe Events
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Webhook events by status</CardTitle>
          <CardDescription>
            Open the event queue filtered to one processing state.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(report.eventsByStatus).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No events recorded.
              </p>
            )}
            {Object.entries(report.eventsByStatus).map(([status, count]) => (
              <Button key={status} asChild variant="outline" size="sm">
                <Link href={`/stripe-events?status=${status}`}>
                  {status}: {count}
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
