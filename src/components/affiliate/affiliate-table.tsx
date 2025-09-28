interface AffiliateRow {
  id?: number;
  user_uuid: string;
  invited_by: string;
  created_at?: Date | null;
  status: string;
  paid_order_no: string;
  paid_amount: number;
  reward_percent: number;
  reward_amount: number;
  user?: { email?: string | null; uuid?: string } | null;
}

function formatDate(d?: Date | null) {
  return d ? new Date(d).toISOString() : "—";
}

function formatCents(n: number) {
  return (n ?? 0) / 100;
}

export default function AffiliateTable({ rows }: { rows: AffiliateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">User</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Order</th>
            <th className="py-2 pr-4">Paid</th>
            <th className="py-2 pr-4">Reward</th>
            <th className="py-2 pr-4">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.paid_order_no}-${r.user_uuid}-${r.created_at ?? "ts"}`} className="border-t">
              <td className="py-2 pr-4">
                <div className="font-mono text-xs">{r.user?.uuid ?? r.user_uuid}</div>
                <div className="text-xs text-muted-foreground">{r.user?.email ?? ""}</div>
              </td>
              <td className="py-2 pr-4">{r.status}</td>
              <td className="py-2 pr-4 font-mono text-xs">{r.paid_order_no || "—"}</td>
              <td className="py-2 pr-4">{r.paid_amount > 0 ? `$${formatCents(r.paid_amount).toFixed(2)}` : "—"}</td>
              <td className="py-2 pr-4">{r.reward_amount > 0 ? `$${formatCents(r.reward_amount).toFixed(2)}` : "—"}</td>
              <td className="py-2 pr-4">{formatDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

