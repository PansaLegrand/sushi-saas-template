import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminShell } from "@admin/components/admin-shell";
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
    <AdminShell email={admin.email} role={admin.role}>
      {children}
    </AdminShell>
  );
}
