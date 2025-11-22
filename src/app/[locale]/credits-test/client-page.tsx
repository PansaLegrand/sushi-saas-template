"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/errors/error-banner";
import type { CreditSummary } from "@/types/credit";
import type { ApiResponse } from "@/types/api";

const LEDGER_LIMIT = 5;
const DEFAULT_CONSUME_AMOUNT = 5;

interface LatestTaskRecord {
  uuid: string;
  type: string;
  status: string;
  creditsUsed: number;
  createdAt: string;
  outputUrl?: string | null;
}

interface ConsumeResponse {
  balance: number;
}

export default function CreditTesterPage() {
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConsuming, setIsConsuming] = useState<boolean>(false);
  const [latestTask, setLatestTask] = useState<LatestTaskRecord | null>(null);

  // Helper that unwraps API responses and throws when the call fails.
  const unwrap = useCallback(async <T,>(res: Response): Promise<T> => {
    const payload = (await res.json()) as ApiResponse<T>;

    if (!res.ok || payload.code !== 0 || payload.data === undefined) {
      const label = payload?.message ?? "Request failed";
      throw new Error(label);
    }

    return payload.data;
  }, []);

  // Loads the latest credit summary so we can display balance and ledger data.
  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/account/credits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          includeLedger: true,
          ledgerLimit: LEDGER_LIMIT,
          includeExpiring: true,
        }),
      });

      const data = await unwrap<CreditSummary>(response);
      setSummary(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load credits";
      setErrorMessage(message);
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [unwrap]);

  const fetchLatestTask = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks/latest", { method: "GET" });
      const payload = (await response.json()) as ApiResponse<{ task: LatestTaskRecord | null }>;
      if (!response.ok || payload.code !== 0) {
        throw new Error(payload?.message ?? "Unable to load latest task");
      }
      setLatestTask(payload.data?.task ?? null);
    } catch {
      // Don’t block the page on task errors; just clear the latest task section
      setLatestTask(null);
    }
  }, []);

  // Tries to consume credits by calling the mock API endpoint.
  const consumeCredits = useCallback(async () => {
    setIsConsuming(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/account/credits/consume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ credits: DEFAULT_CONSUME_AMOUNT }),
      });

      await unwrap<ConsumeResponse>(response);
      await fetchSummary();
      await fetchLatestTask();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to consume credits";
      setErrorMessage(message);
    } finally {
      setIsConsuming(false);
    }
  }, [fetchSummary, fetchLatestTask, unwrap]);

  useEffect(() => {
    void fetchSummary();
    void fetchLatestTask();
  }, [fetchLatestTask, fetchSummary]);

  const balance = summary?.balance ?? 0;

  return (
    <main className="container mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Credits test</h1>
        <p className="text-sm text-muted-foreground">
          Minimal page to exercise the credits API and task creation.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current balance</p>
            <p className="text-2xl font-semibold">{balance}</p>
          </div>
          <div className="space-x-2">
            <button
              type="button"
              onClick={() => void fetchSummary()}
              disabled={isLoading}
              className="rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void consumeCredits()}
              disabled={isConsuming}
              className="rounded-md border border-border bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed"
            >
              {isConsuming ? "Consuming…" : `Consume ${DEFAULT_CONSUME_AMOUNT}`}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Latest task</h2>
        {latestTask ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
            <dt className="font-medium text-foreground">UUID</dt>
            <dd className="truncate">{latestTask.uuid}</dd>
            <dt className="font-medium text-foreground">Type</dt>
            <dd>{latestTask.type}</dd>
            <dt className="font-medium text-foreground">Status</dt>
            <dd>{latestTask.status}</dd>
            <dt className="font-medium text-foreground">Credits used</dt>
            <dd>{latestTask.creditsUsed}</dd>
            {latestTask.outputUrl ? (
              <>
                <dt className="font-medium text-foreground">Output URL</dt>
                <dd className="truncate">{latestTask.outputUrl}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No recent tasks.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Ledger preview</h2>
        {summary?.ledger && summary.ledger.length > 0 ? (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Trans No</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {summary.ledger.map((entry, idx) => (
                <tr key={`${entry.transNo}-${idx}`} className="align-top">
                  <td className="py-2 text-xs font-mono">{entry.transNo}</td>
                  <td className="py-2">{entry.credits}</td>
                  <td className="py-2">{entry.transType}</td>
                  <td className="py-2">
                    {entry.createdAt ? new Date(entry.createdAt as any).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No ledger entries.</p>
        )}
      </section>

      {errorMessage ? (
        <ErrorBanner
          title="Error"
          message={errorMessage}
        />
      ) : null}
    </main>
  );
}
