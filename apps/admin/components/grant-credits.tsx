"use client";

import { useCallback, useMemo, useState } from "react";

import { getUserCredits, grantCredits } from "@admin/lib/api";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/card";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { CreditSummary } from "@/types/credit";

interface Props {
  canWrite: boolean;
}

export default function GrantCreditsPanel({ canWrite }: Props) {
  const [userUuid, setUserUuid] = useState("");
  const [amount, setAmount] = useState("100");
  const [expiredAt, setExpiredAt] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CreditSummary | null>(null);

  const disabled = useMemo(() => loading || !userUuid, [loading, userUuid]);

  const load = useCallback(async () => {
    if (!userUuid) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await getUserCredits(userUuid));
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userUuid]);

  const grant = useCallback(async () => {
    if (!canWrite) return;
    const credits = Number(amount);
    if (!Number.isInteger(credits) || credits <= 0) {
      setError("Credits must be a positive whole number");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await grantCredits({
        userUuid,
        credits,
        expiredAt: expiredAt || null,
        note: note.trim() || undefined,
      });
      setNote("");
      await load();
    } catch (e) {
      setError(resolveErrorMessage(e, null, "CREDITS_GRANT_FAILED"));
    } finally {
      setLoading(false);
    }
  }, [userUuid, amount, expiredAt, note, canWrite, load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          aria-label="User UUID"
          placeholder="User UUID"
          value={userUuid}
          onChange={(e) => setUserUuid(e.currentTarget.value)}
        />
        <Input
          aria-label="Credits"
          type="number"
          min={1}
          placeholder="Credits"
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
        />
        <Input
          aria-label="Expires (optional)"
          type="datetime-local"
          value={expiredAt}
          onChange={(e) => setExpiredAt(e.currentTarget.value)}
        />
      </div>

      <Input
        aria-label="Reason"
        placeholder="Reason (recorded in the audit log)"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />

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

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {summary && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Balance" value={summary.balance} />
            <StatCard label="Granted" value={summary.granted} />
            <StatCard label="Consumed" value={summary.consumed} />
            <StatCard label="Expired" value={summary.expired} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Credits</th>
                  {/* The running total after the row. Counts expired grants, so
                      it will not match the Balance card above — that one is what
                      is spendable today. */}
                  <th className="py-2 pr-4">Balance after</th>
                  {/* Who caused it, which is not the same as who it credits. */}
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Order</th>
                  <th className="py-2 pr-4">Context</th>
                  <th className="py-2 pr-4">Expires</th>
                  <th className="py-2 pr-4">Trans</th>
                </tr>
              </thead>
              <tbody>
                {(summary.ledger ?? []).map((l) => (
                  <tr key={l.transNo} className="border-t align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{l.createdAt}</td>
                    <td className="py-2 pr-4">{l.transType}</td>
                    <td className="py-2 pr-4">{l.credits}</td>
                    {/* A dash, not a zero: rows written before migration 0018
                        have no running total, and showing 0 would read as a
                        drained balance rather than as absent. */}
                    <td className="py-2 pr-4 font-mono text-xs">
                      {l.balanceAfter ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {l.actor ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{l.orderNo || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-[10px]">
                      {l.metadata ? (
                        <span className="whitespace-pre-wrap break-all">
                          {Object.entries(l.metadata)
                            .map(([key, value]) => `${key}=${String(value)}`)
                            .join("\n")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
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

