interface Summary {
  total_invited: number;
  total_paid: number;
  total_reward: number; // minor units (cents) when payoutType = cash
}

function formatCurrencyCents(cents: number, currency = "USD"): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function AffiliateSummaryCards({ summary, currency = "USD" }: { summary: Summary; currency?: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Total invited</p>
        <p className="mt-1 text-2xl font-semibold">{summary.total_invited}</p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Paid users</p>
        <p className="mt-1 text-2xl font-semibold">{summary.total_paid}</p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Total rewards</p>
        <p className="mt-1 text-2xl font-semibold">{formatCurrencyCents(summary.total_reward, currency)}</p>
      </div>
    </div>
  );
}

