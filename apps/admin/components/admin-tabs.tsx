import Link from "next/link";

import { cn } from "@/lib/utils";

export interface AdminTabItem {
  href: string;
  label: string;
  active?: boolean;
  count?: number;
}

/**
 * Section navigation for one operational resource.
 *
 * This is intentionally link-based rather than client state: every tab has a
 * shareable URL, works without hydration, and preserves normal browser history.
 */
export function AdminTabs({
  items,
  label,
  className,
}: {
  items: AdminTabItem[];
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "overflow-x-auto rounded-lg border border-border bg-card p-1.5 shadow-sm",
        className,
      )}
    >
      <div className="flex min-w-max items-center gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs",
                  item.active
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
