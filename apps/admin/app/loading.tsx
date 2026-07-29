import { ShieldCheck } from "lucide-react";

export default function AdminRootLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-screen items-center justify-center bg-muted/20 px-4"
    >
      <div className="flex flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ShieldCheck aria-hidden className="size-6" />
        </span>
        <p className="mt-5 text-sm font-semibold">Opening admin console</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Checking your session and permissions
        </p>
        <span
          aria-hidden
          className="mt-5 size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary motion-reduce:animate-none"
        />
      </div>
    </main>
  );
}
