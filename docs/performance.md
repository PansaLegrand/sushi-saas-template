# Performance contracts

Run `pnpm benchmark:ledger` to measure the ledger replay and logical-history
projection without a database or provider. `pnpm benchmark:ledger -- --check`
enforces broad CPU ceilings at 1,000, 10,000 and 50,000 rows. CI records the same
JSON output. Timings are hardware-sensitive; investigate a failed ceiling before
changing it. The benchmark verifies the full balance and logical row count.

The initial Node 24 local baseline for alternating grants/spends was roughly
0.5 ms at 1,000 rows, 25 ms at 10,000 and 530 ms at 50,000. The growth exposes
the replay allocator's repeated scan of depleted buckets. These figures exclude
SQL, transfer, lock waits, GC under load and concurrent requests. They are not
production latency measurements.

## Optimization order

1. Measure p50/p95/p99 of credit summary, paid admission and organization lock
   wait against a disposable database with realistic expiry/refund histories.
2. Optimize replay's depleted-bucket traversal while retaining exact FEFO,
   historical timestamp, split-spend and refund semantics. Differential tests
   must compare every allocation as well as the balance.
3. Consider transactionally maintained snapshots only if replay/SQL remains a
   measured bottleneck. A snapshot needs expiry handling, reconciliation and
   a rebuild path before it can authorize spending.

Never truncate the ledger to make a balance read fast. File pages are bounded
to 100 rows and credit history pages are applied after logical FEFO grouping;
neither pagination rule changes financial truth.

## Other bounds

- Durable erasure yields after 25 newly completed external effects or when its
  remaining execution window is short. Progress continuations do not consume
  the failure retry budget; actual failures do.
- Storage and provider requests use cancellation/lease fencing. Measure queue
  age and retries independently of HTTP response duration.
- Export polling has a separate read bucket, exponential backoff, and no signed
  links until the customer requests them. The export manifest still collects
  an account's records in memory: benchmark peak memory and object count before
  supporting unusually large accounts. Streaming/chunked exports need their
  own checkpoint, expiry and privacy contract.
