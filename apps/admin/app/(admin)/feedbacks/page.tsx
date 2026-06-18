import { getAdminContext } from "@/lib/authz";
import { getFeedbacks, getFeedbacksTotal } from "@/models/feedback";

export default async function AdminFeedbacksPage() {
  const admin = await getAdminContext();
  if (!admin || (admin.role !== "admin_ro" && admin.role !== "admin_rw")) {
    return null;
  }

  const [rows, total] = await Promise.all([
    getFeedbacks(1, 100),
    getFeedbacksTotal(),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feedbacks</h1>
        <p className="text-sm text-muted-foreground">Total: {total ?? 0}</p>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">ID</th>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Rating</th>
              <th className="py-2 pr-4">Content</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((f) => (
              <tr key={f.id} className="border-t align-top">
                <td className="py-2 pr-4 font-mono text-xs">{f.id}</td>
                <td className="py-2 pr-4">
                  <div className="text-xs text-muted-foreground">{(f as any).user?.email ?? ""}</div>
                  <div className="font-mono text-xs">{f.user_uuid ?? (f as any).user?.uuid ?? "—"}</div>
                </td>
                <td className="py-2 pr-4">{f.rating ?? "—"}</td>
                <td className="py-2 pr-4 whitespace-pre-wrap max-w-[40rem]">{f.content ?? ""}</td>
                <td className="py-2 pr-4 capitalize">{f.status ?? "new"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{f.created_at ? (f.created_at as any).toISOString?.() ?? String(f.created_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

