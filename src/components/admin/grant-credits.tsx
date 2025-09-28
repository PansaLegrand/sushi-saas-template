"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/types/api";

interface Props {
  canWrite: boolean;
}

interface CreditLedgerEntry {
  transNo: string;
  transType: string;
  credits: number;
  createdAt: string;
  orderNo?: string | null;
  expiredAt?: string | null;
}

interface CreditSummary {
  balance: number;
  granted: number;
  consumed: number;
  expired: number;
  expiringSoon?: any[];
  ledger: CreditLedgerEntry[];
}

export default function GrantCreditsPanel({ canWrite }: Props) {
  const [userUuid, setUserUuid] = useState("");
  const [amount, setAmount] = useState("100");
  const [expiredAt, setExpiredAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CreditSummary | null>(null);

  const disabled = useMemo(() => loading || !userUuid, [loading, userUuid]);

  const load = useCallback(async () => {
    if (!userUuid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userUuid)}/credits`);
      const payload = (await res.json()) as ApiResponse<CreditSummary>;
      if (!res.ok || payload.code !== 0) throw new Error(payload.message || "Failed");
      setSummary(payload.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [userUuid]);

  const grant = useCallback(async () => {
    if (!canWrite) return;
    const credits = Number(amount);
    if (!Number.isFinite(credits) || credits <= 0) {
      setError("Credits must be a positive number");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/credits/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userUuid,
          credits,
          expiredAt: expiredAt || null,
        }),
      });
      const payload = (await res.json()) as ApiResponse<any>;
      if (!res.ok || payload.code !== 0) throw new Error(payload.message || "Grant failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grant credits failed");
    } finally {
      setLoading(false);
    }
  }, [userUuid, amount, expiredAt, canWrite, load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          className="rounded border px-3 py-2"
          placeholder="User UUID"
          value={userUuid}
          onChange={(e) => setUserUuid(e.currentTarget.value)}
        />
        <input
          className="rounded border px-3 py-2"
          type="number"
          min={1}
          placeholder="Credits"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
        />
        <input
          className="rounded border px-3 py-2"
          type="datetime-local"
          placeholder="Expires (optional)"
          value={expiredAt}
          onChange={(e) => setExpiredAt(e.currentTarget.value)}
        />
      </div>

      <div className="flex gap-3">
        <button
          className="inline-flex items-center rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => void load()}
          disabled={disabled}
        >
          {loading ? "Loading…" : "Load summary"}
        </button>
        <button
          className="inline-flex items-center rounded bg-secondary px-3 py-2 text-sm text-secondary-foreground disabled:opacity-50"
          onClick={() => void grant()}
          disabled={disabled || !canWrite}
          title={canWrite ? "Grant credits" : "Read-only admin"}
        >
          {loading ? "Working…" : canWrite ? "Grant credits" : "Grant disabled (read-only)"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Balance" value={summary.balance} />
            <Stat label="Granted" value={summary.granted} />
            <Stat label="Consumed" value={summary.consumed} />
            <Stat label="Expired" value={summary.expired} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Credits</th>
                  <th className="py-2 pr-4">Order</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2 pr-4">Trans</th>
                </tr>
              </thead>
              <tbody>
                {(summary.ledger ?? []).map((l) => (
                  <tr key={l.transNo} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">{l.createdAt}</td>
                    <td className="py-2 pr-4">{l.transType}</td>
                    <td className="py-2 pr-4">{l.credits}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{l.orderNo || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{l.expiredAt || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-[10px]">{l.transNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

