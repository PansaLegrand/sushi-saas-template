"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2,
  CalendarDays,
  Coins,
  CreditCard,
  Files,
  ShieldCheck,
  Users,
} from "lucide-react";

import LogoutButton from "@/components/auth/logout-button";
import { Badge } from "@/components/ui/badge";
import { ORGANIZATION_QUERY_PARAM } from "@/config/organization-context";
import { localePath } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import type { OrgNavigationView } from "@/types/organization";

const NAV_ITEMS = [
  { key: "billing", path: "/account/billing", icon: CreditCard },
  { key: "credits", path: "/account/credits", icon: Coins },
  { key: "files", path: "/account/files", icon: Files },
  { key: "team", path: "/account/team", icon: Users },
  {
    key: "reservations",
    path: "/account/reservations",
    icon: CalendarDays,
    reservationOnly: true,
  },
  { key: "profile", path: "/me", icon: ShieldCheck },
] as const;

export default function AccountShell({
  children,
  navigation,
  reservationsEnabled,
}: {
  children: ReactNode;
  navigation: OrgNavigationView;
  reservationsEnabled: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("account");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedSlug = navigation.current.orgSlug;

  function contextualHref(path: string, slug = selectedSlug) {
    const query = new URLSearchParams(searchParams.toString());
    query.set(ORGANIZATION_QUERY_PARAM, slug);
    return `${localePath(locale, path)}?${query.toString()}`;
  }

  function currentPathHref(slug: string) {
    const query = new URLSearchParams(searchParams.toString());
    query.set(ORGANIZATION_QUERY_PARAM, slug);
    return `${pathname}?${query.toString()}`;
  }

  // Convert a legacy/session-selected account URL into a tab-local canonical
  // URL. API buttons are safe even before this effect runs: multi-workspace
  // requests without the header fail closed on the server.
  useEffect(() => {
    if (searchParams.get(ORGANIZATION_QUERY_PARAM) === selectedSlug) return;

    const query = new URLSearchParams(searchParams.toString());
    query.set(ORGANIZATION_QUERY_PARAM, selectedSlug);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, selectedSlug]);

  const items = NAV_ITEMS.filter(
    (item) =>
      !("reservationOnly" in item) ||
      !item.reservationOnly ||
      reservationsEnabled
  );

  return (
    <div className="min-h-screen bg-muted/20">
      <a
        href="#account-content"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("skipToContent")}
      </a>

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
        <aside className="border-b border-border bg-background/95 px-4 py-4 backdrop-blur lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <Link
            href={localePath(locale)}
            className="mb-5 inline-flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            {t("accountHome")}
          </Link>

          <WorkspaceSelector
            navigation={navigation}
            onSelect={(slug) => router.push(currentPathHref(slug))}
          />

          <nav aria-label={t("navigationLabel")} className="mt-4">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {items.map(({ key, path, icon: Icon }) => {
                const href = contextualHref(path);
                const active = pathname.endsWith(path);

                return (
                  <li key={key} className="shrink-0">
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {t(`navigation.${key}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-4 border-t border-border pt-4 lg:mt-auto">
            <LogoutButton />
          </div>
        </aside>

        <div id="account-content" className="min-w-0 flex-1" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSelector({
  navigation,
  onSelect,
}: {
  navigation: OrgNavigationView;
  onSelect: (slug: string) => void;
}) {
  const t = useTranslations("account");
  const current = navigation.current;

  if (navigation.workspaces.length === 1) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("workspace")}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold">{current.orgName}</p>
          <Badge variant="secondary">{t(`roles.${current.role}`)}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <label
        htmlFor="account-workspace"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {t("switchWorkspace")}
      </label>
      <select
        id="account-workspace"
        value={current.orgSlug}
        onChange={(event) => onSelect(event.currentTarget.value)}
        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {navigation.workspaces.map((workspace) => (
          <option key={workspace.slug} value={workspace.slug}>
            {workspace.name} · {t(`roles.${workspace.role}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
