import { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@admin/components/sign-out-button";
import { getAdminContext, getAdminIdentity } from "@admin/lib/authz";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await getAdminContext();
  if (!admin) {
    const identity = await getAdminIdentity();
    if (identity && !identity.mfaEnabled) {
      redirect("/mfa-required");
    }
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-6 space-y-6">
      <header className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {admin.email} ({admin.role})
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            Overview
          </Link>
          <Link href="/feedbacks" className="text-muted-foreground hover:text-foreground">
            Feedbacks
          </Link>
          <Link href="/reservations" className="text-muted-foreground hover:text-foreground">
            Reservations
          </Link>
          <Link href="/affiliates" className="text-muted-foreground hover:text-foreground">
            Affiliates
          </Link>
          <Link href="/organizations" className="text-muted-foreground hover:text-foreground">
            Organizations
          </Link>
          <Link href="/stripe-events" className="text-muted-foreground hover:text-foreground">
            Stripe Events
          </Link>
          <Link href="/audit" className="text-muted-foreground hover:text-foreground">
            Audit Log
          </Link>
          <SignOutButton />
        </nav>
      </header>
      {children}
    </main>
  );
}
