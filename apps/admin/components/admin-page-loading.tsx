import { Skeleton } from "@/components/ui/skeleton";

export function AdminPageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-8"
    >
      <span className="sr-only">Loading admin page</span>

      <div className="space-y-2">
        <Skeleton className="h-3 w-24 motion-reduce:animate-none" />
        <Skeleton className="h-9 w-52 motion-reduce:animate-none" />
        <Skeleton className="h-5 w-full max-w-xl motion-reduce:animate-none" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
                <Skeleton className="h-9 w-16 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
              </div>
              <Skeleton className="size-10 shrink-0 rounded-xl motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-36 motion-reduce:animate-none" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-4 border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <Skeleton className="size-9 shrink-0 rounded-lg motion-reduce:animate-none" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-3/4 motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton
                key={index}
                className="h-14 w-full rounded-lg motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
