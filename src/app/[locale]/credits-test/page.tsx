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
    } catch (error) {
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
    <main className="container mx-auto flex max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <section>
        <h1 className="text-3xl font-semibold">Credit Tester</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use this page to simulate a credit-consuming action. The button below
          withdraws {DEFAULT_CONSUME_AMOUNT} credit at a time and surfaces
          errors (like insufficient balance) via a shared banner component.
        </p>
      </section>

      {errorMessage ? (
        <ErrorBanner
          title="Credit action failed"
          message={errorMessage}
          details={[
            "Check that your account has credits available.",
            "Make sure you are signed in before running the test.",
          ]}
        />
      ) : null}

      <section className="rounded-xl border border-border bg-background p-6 shadow-sm">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Current balance</h2>
            <p className="text-sm text-muted-foreground">
              Includes pending expirations and the {LEDGER_LIMIT}-item ledger
              preview.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => void consumeCredits()}
              disabled={isLoading || isConsuming}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConsuming ? "Consuming…" : `Use ${DEFAULT_CONSUME_AMOUNT} credit`}
            </button>
          </div>
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs uppercase text-muted-foreground">Balance</p>
            <p className="mt-1 text-2xl font-semibold">
              {isLoading ? "—" : balance}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs uppercase text-muted-foreground">Granted</p>
            <p className="mt-1 text-lg font-semibold">
              {isLoading ? "—" : summary?.granted ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs uppercase text-muted-foreground">Consumed</p>
            <p className="mt-1 text-lg font-semibold">
              {isLoading ? "—" : summary?.consumed ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p className="text-xs uppercase text-muted-foreground">Expired</p>
            <p className="mt-1 text-lg font-semibold">
              {isLoading ? "—" : summary?.expired ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-base font-medium">Ledger preview</h3>
          <p className="text-sm text-muted-foreground">
            Latest entries are shown first so you can confirm the mock
            consumption rows (negative credits) are recorded.
          </p>

          <div className="mt-4 overflow-hidden rounded-lg border border-border/60">
            <table className="min-w-full divide-y divide-border/60 text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Credits</th>
                  <th className="px-4 py-2 text-left font-medium">Created</th>
                  <th className="px-4 py-2 text-left font-medium">Order #</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-muted-foreground"
                    >
                      Loading credits…
                    </td>
                  </tr>
                ) : summary && summary.ledger.length > 0 ? (
                  summary.ledger.map((entry) => (
                    <tr key={entry.transNo}>
                      <td className="px-4 py-2 font-medium">
                        {entry.transType}
                      </td>
                      <td className="px-4 py-2">
                        {entry.credits}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {entry.orderNo ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-muted-foreground"
                    >
                      No ledger entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-base font-medium">Latest task</h3>
          <p className="text-sm text-muted-foreground">
            Shows the most recent task you created.
          </p>
          <div className="mt-4 overflow-hidden rounded-lg border border-border/60">
            {!latestTask ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No task yet.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-border/60 text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Type</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Credits</th>
                    <th className="px-4 py-2 text-left font-medium">Created</th>
                    <th className="px-4 py-2 text-left font-medium">Output</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-2 font-medium">{latestTask.type}</td>
                    <td className="px-4 py-2">{latestTask.status}</td>
                    <td className="px-4 py-2">{latestTask.creditsUsed}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(latestTask.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground break-all">
                      {latestTask.outputUrl ? (
                        <a href={latestTask.outputUrl} target="_blank" rel="noreferrer" className="underline">
                          {latestTask.outputUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
