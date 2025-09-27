import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export default async function BillingPage({ params }: { params: { locale: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { locale } = await params;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-2xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, payment methods, and invoices.
        </p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Stripe Customer Portal</p>
            <p className="text-sm text-muted-foreground">Update card, cancel or resume, and view invoices.</p>
          </div>
          <Link href={`/api/billing/portal?locale=${locale}`} prefetch={false}>
            <Button>Manage billing</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}

