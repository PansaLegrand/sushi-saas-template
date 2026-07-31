import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A calm section boundary for admin workflows.
 *
 * Pages provide the content and actions; this component owns the spacing,
 * surface, and heading hierarchy so adjacent sections do not become a stack of
 * unrelated bordered boxes.
 */
export function AdminPanel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const hasHeader = title || description || actions;

  return (
    <Card className={className}>
      {hasHeader ? (
        <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0 space-y-1">
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? (
              <CardDescription className="leading-6">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("p-5 pt-5", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
