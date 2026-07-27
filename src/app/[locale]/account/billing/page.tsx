import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describePlans, getPlanSnapshot } from "@/services/entitlements";
import { getOrgContextFromHeaders } from "@/services/authz";
import { localePath } from "@/i18n/locale";
import type { LimitValue, PlanLimit, PlanSnapshot, Tier } from "@/types/plan";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/account/billing",
    title: `Billing | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

/** How each limit is worded and formatted. Only this screen renders them. */
const LIMIT_LABELS: Record<
  PlanLimit,
  { label: string; format: (value: LimitValue) => string }
> = {
  "storage.maxFileMb": {
    label: "Largest file",
    format: (value) => (value === null ? "Unlimited" : `${value} MB`),
  },
  "storage.totalMb": {
    label: "Total storage",
    format: (value) =>
      value === null
        ? "Unlimited"
        : value >= 1000
          ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} GB`
          : `${value} MB`,
  },
  "tasks.perMonth": {
    label: "Video generations",
    format: (value) => (value === null ? "Unlimited" : `${value} / month`),
  },
};

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as PlanLimit[];

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * What the subscription status means to the person reading it.
 *
 * The raw Stripe status is right for the database and wrong for a customer:
 * `past_due` is jargon, and someone whose card expired needs to be told what
 * to do about it rather than which state they are in.
 */
function describeStatus(
  subscription: NonNullable<PlanSnapshot["subscription"]>
): { tone: "default" | "secondary" | "destructive"; label: string; detail: string | null } {
  const renewal = formatDate(subscription.currentPeriodEnd);

  if (subscription.source === "manual") {
    return {
      tone: "secondary",
      label: "Complimentary",
      detail: renewal ? `Granted access until ${renewal}.` : "Granted access, no end date.",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      tone: "secondary",
      label: "Cancels",
      detail: renewal ? `Your plan ends on ${renewal}.` : "Your plan will not renew.",
    };
  }

  switch (subscription.status) {
    case "trialing":
      return {
        tone: "secondary",
        label: "Trial",
        detail: renewal ? `Your trial converts on ${renewal}.` : null,
      };
    case "past_due":
      return {
        tone: "destructive",
        label: "Payment failed",
        detail: "Update your card to keep your plan. Access continues for a few days.",
      };
    default:
      return {
        tone: "default",
        label: "Active",
        detail: renewal ? `Renews on ${renewal}.` : null,
      };
  }
}

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const requestHeaders = await headers();
  // The plan belongs to the organization being acted in, not to the person.
  const ctx = await getOrgContextFromHeaders(requestHeaders);
  if (!ctx) redirect("/login");

  const { locale } = await params;

  // A Server Component calls the service directly. Fetching our own
  // /api/account/plan from here would turn an in-process call into an HTTP
  // round trip against ourselves — see the frontend rules in AGENTS.md.
  const snapshot = await getPlanSnapshot(ctx.orgUuid);
  const plans = describePlans();
  const status = snapshot.subscription ? describeStatus(snapshot.subscription) : null;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, payment methods, and invoices.
        </p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-lg font-medium">{snapshot.name}</p>
              {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {status?.detail ??
                "You are on the free plan. Upgrade any time — nothing you have stored is affected."}
            </p>
          </div>

          {/* The Stripe portal only knows about Stripe subscriptions. Sending a
              comped or free user there shows them an empty page. */}
          {snapshot.subscription?.source === "stripe" ? (
            <Link href={`/api/billing/portal?locale=${locale}`} prefetch={false}>
              <Button>Manage billing</Button>
            </Link>
          ) : (
            <Link href={localePath(locale, "/pricing")} prefetch={false}>
              <Button>See plans</Button>
            </Link>
          )}
        </div>

        <dl className="grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Included credits
            </dt>
            <dd className="text-sm">{snapshot.includedMonthlyCredits} / month</dd>
          </div>
          {LIMIT_KEYS.map((limit) => (
            <div key={limit}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {LIMIT_LABELS[limit].label}
              </dt>
              <dd className="text-sm">{LIMIT_LABELS[limit].format(snapshot.limits[limit])}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          All plans
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.tier}
              tier={plan.tier}
              name={plan.name}
              credits={plan.includedMonthlyCredits}
              limits={plan.limits}
              isCurrent={plan.tier === snapshot.tier}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Changing plan never deletes anything. If you move to a smaller plan while over its
          limits, what you already have stays — only new uploads and generations wait until you
          are back under.
        </p>
      </section>
    </main>
  );
}

function PlanCard({
  tier,
  name,
  credits,
  limits,
  isCurrent,
}: {
  tier: Tier;
  name: string;
  credits: number;
  limits: Record<PlanLimit, LimitValue>;
  isCurrent: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        isCurrent ? "border-foreground bg-card" : "border-border"
      }`}
      data-tier={tier}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{name}</p>
        {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        <li>{credits} credits / month</li>
        {LIMIT_KEYS.map((limit) => (
          <li key={limit}>
            {LIMIT_LABELS[limit].label}: {LIMIT_LABELS[limit].format(limits[limit])}
          </li>
        ))}
      </ul>
    </div>
  );
}
