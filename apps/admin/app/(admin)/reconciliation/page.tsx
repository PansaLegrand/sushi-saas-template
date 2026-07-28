import Link from "next/link";

import { getAdminContext } from "@admin/lib/authz";
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
    what:
      "The customer paid and the ledger has nothing. The most serious thing this check finds — grant the credits, then find out why fulfillment did not.",
  },
  ledger_balance_drift: {
    title: "Ledger balance drift",
    what:
      "A row's balance_after disagrees with the sum of the ledger before it, which means two writes raced. The balance shown to the customer may be wrong.",
  },
  stuck_event: {
    title: "Stuck webhook events",
    what:
      "Parked for a human, or failed past Stripe's retry window. Resolve or replay them from the events page.",
  },
};

function Severity({ severity }: { severity: ReconcileFinding["severity"] }) {
  const tone =
    severity === "error"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400";

  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${tone}`}>
      {severity}
    </span>
  );
}

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
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Every billing guarantee is enforced by an index or a transaction. This
            is the audit that turns those from beliefs into checks.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          {WINDOWS.map((window) => (
            <Link
              key={window}
              href={`/reconciliation?days=${window}`}
              className={`rounded border px-3 py-1 ${
                days === window
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {window}d
            </Link>
          ))}
        </nav>
      </header>

      <div
        className={`rounded-lg border p-3 text-sm ${
          report.ok ? "" : "border-destructive/30 bg-destructive/10"
        }`}
      >
        {report.ok ? (
          <>
            Nothing at <strong>error</strong> severity since{" "}
            {report.since.slice(0, 10)}.
            {report.findings.length > 0 &&
              ` ${report.findings.length} warning(s) below — worth reading, not urgent.`}
          </>
        ) : (
          <>
            <strong>{errors}</strong> finding{errors === 1 ? "" : "s"} at error
            severity since {report.since.slice(0, 10)}. Money and entitlement may
            disagree right now.
          </>
        )}
      </div>

      {/* Stated rather than implied. Someone reading a green page should know
          exactly which half of the check produced it. */}
      <p className="rounded-lg border p-3 text-xs text-muted-foreground">
        This is the <strong>local</strong> half: it compares this database
        against itself and needs no Stripe key. It cannot detect &ldquo;Stripe
        charged them and we were never told&rdquo; — that requires walking the
        invoice API, which stays in{" "}
        <code>pnpm reconcile:stripe</code>. Findings are capped at{" "}
        {FINDING_LIMIT} per check.
      </p>

      {report.findings.length === 0 && (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          No findings in the last {days} days.
        </div>
      )}

      {[...byKind.entries()].map(([kind, findings]) => {
        const copy = KIND_COPY[kind];

        return (
          <section key={kind} className="rounded-lg border p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-medium">{copy?.title ?? kind}</h2>
              <span className="text-sm text-muted-foreground">
                {findings.length}
              </span>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              {copy?.what ?? "See the detail below."}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Severity</th>
                    <th className="py-2 pr-4">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding, index) => (
                    <tr
                      key={`${kind}-${index}`}
                      className="border-t align-top"
                    >
                      <td className="py-2 pr-4">
                        <Severity severity={finding.severity} />
                      </td>
                      <td className="py-2 pr-4">
                        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                          {Object.entries(finding.detail).map(([key, value]) => (
                            <div key={key} className="flex gap-2">
                              <dt className="text-xs text-muted-foreground">
                                {key}
                              </dt>
                              <dd className="font-mono text-xs break-all">
                                {value === null || value === undefined
                                  ? "—"
                                  : String(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {kind === "order_missing_credits" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Each of these is one row in{" "}
                <Link href="/orders?status=paid" className="underline">
                  Orders
                </Link>{" "}
                showing <span className="text-destructive">none</span> granted.
              </p>
            )}
            {kind === "stuck_event" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Act on these from{" "}
                <Link href="/stripe-events?status=action_required" className="underline">
                  Stripe Events
                </Link>
                .
              </p>
            )}
          </section>
        );
      })}

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-medium">Webhook events by status</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(report.eventsByStatus).length === 0 && (
            <span className="text-muted-foreground">No events recorded.</span>
          )}
          {Object.entries(report.eventsByStatus).map(([status, count]) => (
            <Link
              key={status}
              href={`/stripe-events?status=${status}`}
              className="rounded border px-3 py-1 underline"
            >
              {status}: {count}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
