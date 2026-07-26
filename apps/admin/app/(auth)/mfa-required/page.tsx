import Link from "next/link";

import { getAppEnv } from "@/lib/env";
import { getAdminIdentity } from "@admin/lib/authz";

export default async function AdminMfaRequiredPage() {
  const identity = await getAdminIdentity();
  const accountUrl = new URL("/en/me", getAppEnv().NEXT_PUBLIC_WEB_URL).toString();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <section className="w-full max-w-md rounded-lg border bg-background p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Two-factor required</h1>
          <p className="text-sm text-muted-foreground">
            Admin access requires two-factor authentication. Enable it from your account page,
            then return to the admin console.
          </p>
          {identity ? (
            <p className="text-xs text-muted-foreground">
              Signed in as {identity.email} ({identity.role}).
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={accountUrl}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            Open account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            Back to login
          </Link>
        </div>
      </section>
    </main>
  );
}
