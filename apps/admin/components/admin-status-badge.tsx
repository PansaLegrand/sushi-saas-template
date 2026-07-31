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
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
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
