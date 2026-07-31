"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { ExpirationPicker } from "@admin/components/expiration-picker";
import { getUserCredits, grantCredits } from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { CreditSummary } from "@/types/credit";

interface Props {
  canWrite: boolean;
}

export default function GrantCreditsPanel({ canWrite }: Props) {
  const [userUuid, setUserUuid] = useState("");
  const [amount, setAmount] = useState("100");
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const grantAttemptRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
    inFlight: boolean;
  } | null>(null);

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
    const normalizedUserUuid = userUuid.trim();
    if (!normalizedUserUuid) return;
    const normalizedNote = note.trim();
    const fingerprint = JSON.stringify([
      normalizedUserUuid,
      credits,
      expiredAt,
      normalizedNote,
    ]);
    const currentAttempt = grantAttemptRef.current;
    if (currentAttempt?.inFlight) return;

    const idempotencyKey =
      currentAttempt?.fingerprint === fingerprint
        ? currentAttempt.idempotencyKey
        : crypto.randomUUID();
    grantAttemptRef.current = {
      fingerprint,
      idempotencyKey,
      inFlight: true,
    };

    let confirmed = false;
    setLoading(true);
    setError(null);
    try {
      await grantCredits({
        userUuid: normalizedUserUuid,
        credits,
        expiredAt,
        note: normalizedNote || undefined,
        idempotencyKey,
      });
      confirmed = true;
      setNote("");
      await load();
    } catch (e) {
      setError(resolveErrorMessage(e, null, "CREDITS_GRANT_FAILED"));
    } finally {
      grantAttemptRef.current = confirmed
        ? null
        : { fingerprint, idempotencyKey, inFlight: false };
      setLoading(false);
    }
  }, [userUuid, amount, expiredAt, note, canWrite, load]);

  return (
    <div className="space-y-5" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
        <Field label="User UUID" required>
          {(field) => (
            <Input
              {...field}
              aria-label="User UUID"
              placeholder="Paste a user UUID"
              value={userUuid}
              onChange={(e) => setUserUuid(e.currentTarget.value)}
              required
            />
          )}
        </Field>
        <Field label="Credit amount" required>
          {(field) => (
            <Input
              {...field}
              type="number"
              min={1}
              placeholder="100"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              required
            />
          )}
        </Field>
        <ExpirationPicker
          kind="credits"
          value={expiredAt}
          onChange={setExpiredAt}
          disabled={loading}
        />
      </div>

      <Field
        label="Reason"
        description="Explain the grant so another operator can understand the audit record."
      >
        {(field) => (
          <Input
            {...field}
            placeholder="Why are these credits being granted?"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={disabled}
        >
          {loading ? "Loading…" : "Load summary"}
        </Button>
        <Button
          type="button"
          onClick={() => void grant()}
          disabled={disabled || !canWrite}
          title={canWrite ? "Grant credits" : "Read-only admin"}
        >
          {loading
            ? "Working…"
            : canWrite
              ? "Grant credits"
              : "Grant disabled (read-only)"}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {summary && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Balance" value={summary.balance} />
            <StatCard label="Granted" value={summary.granted} />
            <StatCard label="Consumed" value={summary.consumed} />
            <StatCard label="Expired" value={summary.expired} />
          </div>
          <Table className="min-w-[72rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Credits</TableHead>
                {/* The running total after the row. Counts expired grants, so
                    it will not match the Balance card above — that one is what
                    is spendable today. */}
                <TableHead>Balance after</TableHead>
                {/* Who caused it, which is not the same as who it credits. */}
                <TableHead>Actor</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Transaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(summary.ledger ?? []).map((l) => (
                <TableRow key={l.transNo} className="align-top">
                  <TableCell className="whitespace-nowrap font-mono">
                    {l.createdAt}
                  </TableCell>
                  <TableCell>{l.transType}</TableCell>
                  <TableCell>{l.credits}</TableCell>
                  {/* A dash, not a zero: rows written before migration 0018
                      have no running total, and showing 0 would read as a
                      drained balance rather than as absent. */}
                  <TableCell className="font-mono">
                    {l.balanceAfter ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono">{l.actor ?? "—"}</TableCell>
                  <TableCell className="font-mono">
                    {l.orderNo || "—"}
                  </TableCell>
                  <TableCell className="max-w-80 font-mono">
                    {l.metadata ? (
                      <span className="whitespace-pre-wrap break-all">
                        {Object.entries(l.metadata)
                          .map(([key, value]) => `${key}=${String(value)}`)
                          .join("\n")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono">
                    {l.expiredAt || "—"}
                  </TableCell>
                  <TableCell className="font-mono">{l.transNo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
