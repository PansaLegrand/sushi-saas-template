/**
 * Reconcile Stripe against this database. `pnpm reconcile:stripe`
 *
 * Answers one question: does what Stripe thinks happened match what we recorded?
 * Every billing guarantee in this kit is enforced by an index, a transaction, or
 * an advisory lock — and a guarantee nobody audits is a belief. The failures worth
 * catching here are the silent ones, which throw nothing and alert nobody.
 *
 * Written in TypeScript and run through `tsx` on purpose, unlike the `.mjs`
 * scripts beside it. The comparison logic lives in
 * `src/services/stripe/reconcile.ts` where the database tier tests it; a `.mjs`
 * script would have to re-implement the same SQL and would drift from it silently
 * — which is the exact failure mode this script exists to detect.
 *
 * Usage:
 *   pnpm reconcile:stripe                 # last 7 days, Stripe included if keyed
 *   pnpm reconcile:stripe --days 30
 *   pnpm reconcile:stripe --local-only    # no Stripe API call
 *   pnpm reconcile:stripe --json          # machine-readable, for a pipeline
 *
 * Exits 1 when anything at `error` severity is found, so it can gate a release.
 * Warnings — a parked event a human is already looking at — exit 0 deliberately:
 * a check that blocks every deploy until someone maps a price is a check that
 * gets switched off.
 */
import { config } from "dotenv";

// Type-only, so it is erased and does not pull the module in before the env
// checks below have run.
import type { InvoiceSummary } from "../src/services/stripe/reconcile";

config({ path: ".env" });
config({ path: ".env.local", override: true });

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const localOnly = process.argv.includes("--local-only");
const asJson = process.argv.includes("--json");
const days = Number(flagValue("days") ?? 7);

if (!Number.isFinite(days) || days <= 0) {
  console.error("--days must be a positive number");
  process.exit(1);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "DATABASE_URL is required.\n\n  DATABASE_URL=postgres://... pnpm reconcile:stripe\n"
  );
  process.exit(1);
}

async function main() {
  // Imported lazily so the env checks above run before `@/db` reads the URL.
  const { reconcileLocalBilling, reconcileStripeInvoices } = await import(
    "../src/services/stripe/reconcile"
  );

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stripeKey = process.env.STRIPE_PRIVATE_KEY?.trim();

  let report;

  if (localOnly || !stripeKey) {
    if (!localOnly) {
      console.warn(
        "STRIPE_PRIVATE_KEY is not set — running local checks only. " +
          "This cannot detect an invoice Stripe charged and we never recorded."
      );
    }
    report = await reconcileLocalBilling({ since });
  } else {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const invoices: InvoiceSummary[] = [];

    // `autoPagingEach` rather than one `list` call: a busy month is more than the
    // 100-item default page, and silently checking the newest 100 invoices while
    // reporting success would be worse than not running at all.
    await stripe.invoices
      .list({
        status: "paid",
        created: { gte: Math.floor(since.getTime() / 1000) },
        limit: 100,
      })
      .autoPagingEach((invoice) => {
        const line =
          invoice.lines?.data?.find((l) => l.period?.start) ??
          invoice.lines?.data?.[0];

        invoices.push({
          id: invoice.id,
          subscription:
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : (invoice.subscription?.id ?? null),
          period_start: line?.period?.start ?? null,
          amount_paid: invoice.amount_paid ?? null,
          customer:
            typeof invoice.customer === "string"
              ? invoice.customer
              : (invoice.customer?.id ?? null),
        });
      });

    report = await reconcileStripeInvoices({ since, invoices });
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const errors = report.findings.filter((f) => f.severity === "error");
    const warnings = report.findings.filter((f) => f.severity === "warn");

    console.log(`Reconciling since ${report.since}`);
    console.log(`  Stripe invoices checked: ${report.checkedInvoices}`);
    console.log(`  Webhook events by status: ${JSON.stringify(report.eventsByStatus)}`);
    console.log("");

    for (const finding of [...errors, ...warnings]) {
      const mark = finding.severity === "error" ? "FAIL" : "warn";
      console.log(`  [${mark}] ${finding.kind} ${JSON.stringify(finding.detail)}`);
    }

    console.log("");
    if (errors.length === 0 && warnings.length === 0) {
      console.log("No drift found.");
    } else {
      console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
    }
  }

  // Close the pool so the process exits rather than hanging on an idle client.
  const { db } = await import("../src/db");
  const client = (db() as unknown as { $client?: { end?: () => Promise<void> } })
    .$client;
  await client?.end?.();

  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
