import { AdminTwoFactorForm } from "@admin/components/admin-two-factor-form";

export default function AdminTwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <section className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
          <p className="text-sm text-muted-foreground">
            Enter your authenticator code to finish signing in to admin.
          </p>
        </div>
        <AdminTwoFactorForm />
      </section>
    </main>
  );
}
