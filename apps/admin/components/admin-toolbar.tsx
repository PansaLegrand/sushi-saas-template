import type { ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AdminToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-16 flex-col justify-center gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminSearchToolbar({
  defaultValue,
  placeholder,
  ariaLabel,
  clearHref,
  hiddenInputs = [],
  children,
  className,
}: {
  defaultValue?: string;
  placeholder: string;
  ariaLabel: string;
  clearHref: string;
  hiddenInputs?: ReadonlyArray<{ name: string; value: string }>;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <AdminToolbar className={className}>
      {children}
      <form
        method="get"
        className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end"
      >
        {hiddenInputs.map(({ name, value }) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Input
          type="search"
          name="q"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className="w-full sm:max-w-xl"
          aria-label={ariaLabel}
        />
        <Button type="submit" className="sm:self-stretch">
          Search
        </Button>
        {defaultValue ? (
          <Button asChild variant="ghost">
            <Link href={clearHref}>Clear</Link>
          </Button>
        ) : null}
      </form>
    </AdminToolbar>
  );
}

export function AdminFilterNav({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {children}
    </nav>
  );
}

export function AdminFilterLink({
  href,
  active,
  children,
  count,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  count?: number;
}) {
  return (
    <Button
      asChild
      variant={active ? "default" : "outline"}
      size="sm"
      aria-current={active ? "page" : undefined}
    >
      <Link href={href}>
        {children}
        {count === undefined ? null : (
          <span
            className={cn(
              "ml-1 tabular-nums",
              active ? "text-primary-foreground/75" : "text-muted-foreground",
            )}
          >
            {count}
          </span>
        )}
      </Link>
    </Button>
  );
}
