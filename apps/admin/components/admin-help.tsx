import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Keeps operational guidance available without placing a wall of prose before
 * the action an operator came to perform.
 */
export function AdminHelp({
  summary = "How this works",
  children,
  className,
}: {
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={cn(
        "group rounded-lg border border-border bg-muted/30",
        className,
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <CircleHelp aria-hidden className="size-4 text-muted-foreground" />
        {summary}
        <span
          aria-hidden
          className="ml-auto text-muted-foreground transition-transform group-open:rotate-180"
        >
          ↓
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
