"use client";

/**
 * Admin console error boundary.
 *
 * Admin pages read through `apps/admin/lib/data.ts` during render, so a database
 * hiccup surfaces here rather than through an API response. The console is
 * English-only by design (see apps/admin/README.md), but the message still goes
 * through the catalog so an operator never sees a raw driver error — those tend
 * to carry connection strings.
 */

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveErrorMessage } from "@/lib/errors/client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-6 px-6 py-16">
      <Alert variant="destructive" className="text-left">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p>{resolveErrorMessage(error)}</p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs opacity-70">
              Reference: {error.digest}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>

      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
