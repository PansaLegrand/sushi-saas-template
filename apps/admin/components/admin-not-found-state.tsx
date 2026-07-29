import { LayoutDashboard, SearchX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminNotFoundState({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  return (
    <section
      aria-labelledby="admin-not-found-title"
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center",
        embedded ? "min-h-[55vh]" : "min-h-screen bg-muted/20",
      )}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchX aria-hidden className="size-6" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Error 404
        </p>
        <h1
          id="admin-not-found-title"
          className="mt-1 text-2xl font-semibold tracking-tight"
        >
          Admin page not found
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          This page or record may have moved, been removed, or never existed.
          Use the overview to continue working.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">
            <LayoutDashboard aria-hidden className="mr-2 size-4" />
            Back to overview
          </Link>
        </Button>
      </div>
    </section>
  );
}
