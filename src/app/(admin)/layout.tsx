import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/authz";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await getAdminContext();
  if (!admin || (admin.role !== "admin_ro" && admin.role !== "admin_rw")) {
    redirect("/");
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {admin.email} ({admin.role})
        </p>
      </header>
      {children}
    </main>
  );
}
