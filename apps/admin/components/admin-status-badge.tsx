import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type AdminStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

const TONE_CLASSES: Record<AdminStatusTone, string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  info: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger:
    "border-destructive/30 bg-destructive/10 text-destructive dark:text-red-300",
};

export function AdminStatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: AdminStatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
