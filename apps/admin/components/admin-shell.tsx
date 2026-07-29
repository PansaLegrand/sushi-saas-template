"use client";

import type { ComponentType, ReactNode, SVGProps } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";

import { SignOutButton } from "@admin/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface AdminNavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/users", label: "Users", icon: Users },
      { href: "/organizations", label: "Organizations", icon: Building2 },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/orders", label: "Orders", icon: CreditCard },
      { href: "/stripe-events", label: "Stripe events", icon: Webhook },
      { href: "/reconciliation", label: "Reconciliation", icon: Scale },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/reservations", label: "Reservations", icon: CalendarDays },
      { href: "/feedbacks", label: "Feedback", icon: MessageSquareText },
      { href: "/affiliates", label: "Affiliates", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Trust & safety",
    items: [
      { href: "/moderation", label: "Moderation", icon: ShieldAlert },
      { href: "/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AdminNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav
      aria-label="Admin navigation"
      className="flex-1 overflow-y-auto px-3 py-5"
    >
      <div className="space-y-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0",
                          active
                            ? "text-sidebar-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ConsoleIdentity({
  email,
  role,
}: {
  email: string;
  role: "admin_ro" | "admin_rw";
}) {
  const accessLabel = role === "admin_rw" ? "Read & write" : "Read only";

  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="mb-3 flex min-w-0 items-center gap-3 px-2">
        <div
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
        >
          {email.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{email}</p>
          <p className="text-xs text-muted-foreground">{accessLabel}</p>
        </div>
      </div>
      <SignOutButton className="w-full justify-start" />
    </div>
  );
}

function ConsoleBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex min-h-16 items-center gap-3 border-b border-sidebar-border px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
        <ShieldCheck aria-hidden className="size-5" />
      </span>
      <span>
        <span className="block text-sm font-semibold leading-tight">
          Admin console
        </span>
        <span className="block text-xs text-muted-foreground">
          Operations workspace
        </span>
      </span>
    </Link>
  );
}

function SidebarContent({
  email,
  role,
  pathname,
  onNavigate,
}: {
  email: string;
  role: "admin_ro" | "admin_rw";
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <ConsoleBrand onNavigate={onNavigate} />
      <AdminNavigation pathname={pathname} onNavigate={onNavigate} />
      <ConsoleIdentity email={email} role={role} />
    </div>
  );
}

export function AdminShell({
  children,
  email,
  role,
}: {
  children: ReactNode;
  email: string;
  role: "admin_ro" | "admin_rw";
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-muted/20">
      <a
        href="#admin-main-content"
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border lg:block">
        <SidebarContent email={email} role={role} pathname={pathname} />
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open admin navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden className="size-5" />
          </Button>
          <div>
            <p className="text-sm font-semibold leading-tight">Admin console</p>
            <p className="max-w-52 truncate text-xs text-muted-foreground">
              {email}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[0.6875rem] font-medium text-muted-foreground">
          {role === "admin_rw" ? "Read & write" : "Read only"}
        </span>
      </header>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className={cn(
            "left-0 top-0 h-dvh w-[min(19rem,88vw)] max-w-none -translate-x-0 -translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0",
            "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          )}
        >
          <DialogTitle className="sr-only">Admin navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate between admin console sections.
          </DialogDescription>
          <SidebarContent
            email={email}
            role={role}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <div className="lg:pl-64">
        <main
          id="admin-main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[90rem] px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
