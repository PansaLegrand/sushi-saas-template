/** Synthetic CPU benchmark: no database reads/writes and no provider calls. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { calculateCreditBalance, collapseCreditRowsToLogical, type CreditRow } from "../src/models/credit";

const args = process.argv.slice(2).filter(arg => arg !== "--");
if (args.some(arg => arg !== "--check")) throw new Error("Usage: pnpm benchmark:ledger [--check]");
const check = args.includes("--check");
// Deliberately broad CPU regression ceilings, not request-latency promises.
const cases = [{ rows: 1_000, budgetMs: 100 }, { rows: 10_000, budgetMs: 500 }, { rows: 50_000, budgetMs: 2_500 }];
let exceeded = false;
for (const { rows: size, budgetMs } of cases) {
  const rows: CreditRow[] = Array.from({ length: size }, (_, index) => ({
    id: index + 1, trans_no: `benchmark:${index}`, created_at: new Date(1_700_000_000_000 + index),
    user_uuid: "benchmark", org_uuid: "benchmark", trans_type: index % 2 ? "spend" : "grant",
    credits: index % 2 ? -1 : 1, order_no: "", expired_at: null, balance_after: null,
    actor: "system:benchmark", metadata_json: null,
  }));
  const run = () => {
    const start = performance.now();
    const balance = calculateCreditBalance(rows, new Date(1_800_000_000_000));
    const logical = collapseCreditRowsToLogical(rows);
    assert.equal(balance.available, 0);
    assert.equal(logical.length, size);
    return performance.now() - start;
  };
  run(); // warm-up is excluded
  const samples = Array.from({ length: 7 }, run).sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  const result = { rows: size, medianMs: Math.round(samples[3]! * 10) / 10, p95Ms: Math.round(p95 * 10) / 10, budgetMs, passed: p95 <= budgetMs };
  console.log(JSON.stringify(result));
  if (!result.passed) exceeded = true;
}
if (check && exceeded) process.exitCode = 1;
