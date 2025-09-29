import { getAdminContext } from "@/lib/authz";
import { getUsers } from "@/models/user";
import { getPaiedOrders } from "@/models/order";
import GrantCreditsPanel from "@/components/admin/grant-credits";
import Link from "next/link";

export default async function AdminHomePage() {
  const admin = await getAdminContext();
  // Layout already guards; this is a type-safety fallback.
  const canWrite = admin?.role === "admin_rw";

  const [users, orders] = await Promise.all([
    getUsers(1, 20),
    getPaiedOrders(1, 20),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Reservations</h2>
          <Link href="/admin/reservations" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Check upcoming and past appointments.</p>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Users (latest 20)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">UUID</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{u.uuid}</td>
                  <td className="py-2 pr-4">{(u as any).role ?? "user"}</td>
                  <td className="py-2 pr-4">
                    {u.created_at ? u.created_at.toISOString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Paid Orders (latest 20)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Order No</th>
                <th className="py-2 pr-4">User UUID</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Credits</th>
                <th className="py-2 pr-4">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{o.order_no}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{o.user_uuid}</td>
                  <td className="py-2 pr-4">{o.amount}</td>
                  <td className="py-2 pr-4">{o.credits}</td>
                  <td className="py-2 pr-4">
                    {o.paid_at ? o.paid_at.toISOString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">User Credits</h2>
        <GrantCreditsPanel canWrite={!!canWrite} />
      </section>
    </div>
  );
}
