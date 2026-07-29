import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localePath } from "@/i18n/locale";
import { getOrgCreditSummary } from "@/services/credit";
import { describePlans, getPlanSnapshot } from "@/services/entitlements";
import {
  can as canOrg,
  getOrgContextFromHeaders,
} from "@/services/authz";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import type {
  BillingSubscriptionSnapshot,
  LimitValue,
  PlanLimit,
  Tier,
} from "@/types/plan";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [tMeta, t] = await Promise.all([
    getTranslations(),
    getTranslations("account.billing"),
  ]);
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/account/billing",
    title: `${t("title")} | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

const LIMIT_KEYS = [
  "storage.maxFileMb",
  "storage.totalMb",
  "tasks.perMonth",
] as const satisfies readonly PlanLimit[];

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function limitLabelKey(limit: PlanLimit): string {
  switch (limit) {
    case "storage.maxFileMb":
      return "limits.largestFile";
    case "storage.totalMb":
      return "limits.totalStorage";
    case "tasks.perMonth":
      return "limits.videoGenerations";
  }
}

function formatLimit(
  limit: PlanLimit,
  value: LimitValue,
  t: Translate,
): string {
  if (value === null) return t("limits.unlimited");

  switch (limit) {
    case "storage.maxFileMb":
      return t("limits.megabytes", { value });
    case "storage.totalMb":
      return value >= 1000
        ? t("limits.gigabytes", {
            value: Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)),
          })
        : t("limits.megabytes", { value });
    case "tasks.perMonth":
      return t("limits.perMonth", { value });
  }
}

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

type StatusDescription = {
  tone: "default" | "secondary" | "destructive";
  labelKey: string;
  detailKey: string | null;
};

function describeStatus(
  subscription: BillingSubscriptionSnapshot,
): StatusDescription {
  if (subscription.source === "manual") {
    return {
      tone: "secondary",
      labelKey: "statuses.complimentary",
      detailKey: subscription.currentPeriodEnd
        ? "statuses.complimentaryUntil"
        : "statuses.complimentaryForever",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      tone: "secondary",
      labelKey: "statuses.cancels",
      detailKey: subscription.currentPeriodEnd
        ? "statuses.endsOn"
        : "statuses.willNotRenew",
    };
  }

  switch (subscription.status) {
    case "trialing":
      return {
        tone: "secondary",
        labelKey: "statuses.trial",
        detailKey: subscription.currentPeriodEnd
          ? "statuses.trialConvertsOn"
          : null,
      };
    case "past_due":
      return {
        tone: "destructive",
        labelKey: "statuses.paymentFailed",
        detailKey: "statuses.paymentFailedDetail",
      };
    default:
      return {
        tone: "default",
        labelKey: "statuses.active",
        detailKey: subscription.currentPeriodEnd
          ? "statuses.renewsOn"
          : null,
      };
  }
}

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const requestHeaders = await headers();
  const ctx = await getOrgContextFromHeaders(requestHeaders);
  if (!ctx) redirect("/login");

  const { locale } = await params;
  const [snapshot, credits, t] = await Promise.all([
    getPlanSnapshot(ctx.orgUuid),
    getOrgCreditSummary(ctx.orgUuid, {
      includeLedger: false,
      includeExpiring: true,
    }),
    getTranslations("account.billing"),
  ]);
  const translate: Translate = (key, values) => t(key, values);
  const canManageBilling = canOrg(ctx, "billing:manage");
  const hasStripeSubscription = snapshot.subscriptions.some(
    (subscription) => subscription.source === "stripe",
  );
  const creditsPerRenewal = snapshot.subscriptions
    .filter(
      (subscription) =>
        subscription.source === "stripe" && subscription.entitling,
    )
    .reduce(
      (total, subscription) =>
        total + subscription.includedMonthlyCredits,
      0,
    );
  const expiringSoon = credits.expiringSoon.reduce(
    (total, entry) => total + entry.credits,
    0,
  );
  const pricingUrl = new URL(
    localePath(locale, "/pricing"),
    "https://account.invalid",
  );
  pricingUrl.searchParams.set("org", ctx.orgSlug);
  const pricingHref = `${pricingUrl.pathname}${pricingUrl.search}`;
  const plans = describePlans();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-4xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <section
        aria-labelledby="effective-plan-title"
        className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p
              id="effective-plan-title"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("effectivePlan")}
            </p>
            <p className="text-xl font-semibold">{snapshot.name}</p>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {snapshot.subscriptions.length > 1
                ? t("effectiveStackedDescription")
                : snapshot.subscriptions.length === 0
                  ? t("freeDescription")
                  : t("effectiveDescription")}
            </p>
          </div>

          {canManageBilling ? (
            <div className="flex flex-wrap gap-2">
              {hasStripeSubscription ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/api/billing/portal?locale=${encodeURIComponent(locale)}&org=${encodeURIComponent(ctx.orgSlug)}`}
                    prefetch={false}
                  >
                    {t("actions.manage")}
                  </Link>
                </Button>
              ) : null}
              <Button asChild>
                <Link href={pricingHref} prefetch={false}>
                  {t("actions.addSubscription")}
                </Link>
              </Button>
            </div>
          ) : (
            <p className="max-w-xs rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t("actions.ownerOnly")}
            </p>
          )}
        </div>

        <dl className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("currentBalance")}
            </dt>
            <dd className="text-lg font-semibold">
              {t("creditsValue", { value: credits.balance })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("creditsPerRenewal")}
            </dt>
            <dd className="text-lg font-semibold">
              {t("creditsValue", { value: creditsPerRenewal })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("expiringSoon")}
            </dt>
            <dd className="text-lg font-semibold">
              {t("creditsValue", { value: expiringSoon })}
            </dd>
          </div>
          {LIMIT_KEYS.map((limit) => (
            <div key={limit}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t(limitLabelKey(limit))}
              </dt>
              <dd className="text-sm">
                {formatLimit(limit, snapshot.limits[limit], translate)}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          href={`${localePath(locale, "/account/credits")}?org=${encodeURIComponent(ctx.orgSlug)}`}
          className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("viewCreditHistory")}
        </Link>
      </section>

      <section aria-labelledby="subscriptions-title" className="space-y-4">
        <div className="space-y-1">
          <h2 id="subscriptions-title" className="text-xl font-semibold">
            {t("subscriptionsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("subscriptionsDescription")}
          </p>
        </div>

        {snapshot.subscriptions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t("noSubscriptions")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {snapshot.subscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                locale={locale}
                t={translate}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="all-plans-title" className="space-y-4">
        <h2
          id="all-plans-title"
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          {t("allPlans")}
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
              t={translate}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("dataPolicy")}</p>
      </section>
    </main>
  );
}

function SubscriptionCard({
  subscription,
  locale,
  t,
}: {
  subscription: BillingSubscriptionSnapshot;
  locale: string;
  t: Translate;
}) {
  const status = describeStatus(subscription);
  const periodEnd = formatDate(subscription.currentPeriodEnd, locale);
  const detail = status.detailKey
    ? t(status.detailKey, periodEnd ? { date: periodEnd } : undefined)
    : null;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{subscription.name}</p>
          <p className="text-xs text-muted-foreground">
            {subscription.source === "stripe"
              ? t("paidSubscription")
              : t("complimentarySubscription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {subscription.effective ? (
            <Badge variant="secondary">{t("effectiveBadge")}</Badge>
          ) : null}
          <Badge variant={status.tone}>{t(status.labelKey)}</Badge>
        </div>
      </div>

      {subscription.source === "stripe" ? (
        <p className="text-sm">
          {t("subscriptionCredits", {
            value: subscription.includedMonthlyCredits,
          })}
        </p>
      ) : null}
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
    </article>
  );
}

function PlanCard({
  tier,
  name,
  credits,
  limits,
  isCurrent,
  t,
}: {
  tier: Tier;
  name: string;
  credits: number;
  limits: Record<PlanLimit, LimitValue>;
  isCurrent: boolean;
  t: Translate;
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
        {isCurrent ? <Badge variant="secondary">{t("current")}</Badge> : null}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        <li>{t("planCredits", { value: credits })}</li>
        {LIMIT_KEYS.map((limit) => (
          <li key={limit}>
            {t(limitLabelKey(limit))}: {formatLimit(limit, limits[limit], t)}
          </li>
        ))}
      </ul>
    </div>
  );
}
