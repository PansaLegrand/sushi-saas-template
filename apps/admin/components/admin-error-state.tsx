"use client";

import { useEffect, useRef } from "react";
import { LayoutDashboard, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveErrorMessage } from "@/lib/errors/client";
import { cn } from "@/lib/utils";

export interface AdminBoundaryError extends Error {
  digest?: string;
}

/**
 * Safe recovery UI shared by the admin route boundaries.
 *
 * The exception text is intentionally never rendered. Database and provider
 * errors can contain credentials or request details; the catalog supplies
 * operator-safe copy, while Next's digest is enough to correlate the screen
 * with the server log.
 */
export function AdminErrorState({
  error,
  reset,
  embedded = false,
}: {
  error: AdminBoundaryError;
  reset: () => void;
  embedded?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // The server logs render failures itself. This records client-only failures
    // without printing potentially sensitive exception text to the page.
    console.error("Admin console render failure", error);
  }, [error]);

  return (
    <section
      aria-labelledby="admin-error-title"
      aria-describedby="admin-error-description"
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center",
        embedded ? "min-h-[55vh]" : "min-h-screen bg-muted/20",
      )}
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <TriangleAlert aria-hidden className="size-6" />
        </span>

        <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-destructive">
          Recovery
        </p>
        <h1
          ref={headingRef}
          id="admin-error-title"
          tabIndex={-1}
          className="mt-1 text-2xl font-semibold tracking-tight outline-none"
        >
          This admin view could not load
        </h1>
        <p
          id="admin-error-description"
          className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground"
        >
          Retry the view. If you just submitted a change, verify its result
          before repeating the action.
        </p>

        <Alert variant="destructive" className="mt-6 text-left">
          <AlertDescription>
            <p>{resolveErrorMessage(error)}</p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs opacity-70">
                Reference: {error.digest}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>

        <div className="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">
          <Button variant="outline" asChild>
            <Link href="/">
              <LayoutDashboard aria-hidden className="mr-2 size-4" />
              Back to overview
            </Link>
          </Button>
          <Button type="button" onClick={reset}>
            <RefreshCw aria-hidden className="mr-2 size-4" />
            Try again
          </Button>
        </div>
      </div>
    </section>
  );
}
