/**
 * The harness's own guarantee: this tier owns the database while it runs.
 *
 * `resetTables` is a `truncate ... cascade`, and the tier is opt-in against a
 * database a developer names themselves. Nothing stops a second process — a
 * stray `pnpm test:db`, an editor task, a CI job sharing one database, another
 * agent in the same checkout — from pointing at it too. When that happened, the
 * other process truncated `users` between a test's seed and its assertions, and
 * the symptom was "failed to create personal organization" thrown from
 * `beforeEach`: an error about auth, on a test about credits, roughly a third of
 * runs, never reproducible in isolation.
 *
 * `vitest.config.mts` solves the same problem *within* a run with `singleFork`.
 * This is the across-runs half, and it is asserted rather than assumed because
 * the failure it prevents is so misleading to debug.
 */
import { expect, it } from "vitest";
import postgres from "postgres";

import { TIER_LOCK_KEY, describeDb, useCleanDatabase } from "./setup";

describeDb("database tier harness", () => {
  useCleanDatabase();

  it("holds an exclusive advisory lock for as long as tests are running", async () => {
    // A separate connection on purpose: the lock is invisible to the session
    // that holds it in any way that distinguishes it from not being held.
    const observer = postgres(process.env.TEST_DATABASE_URL!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });

    try {
      const [held] = await observer<{ n: number }[]>`
        select count(*)::int as n
        from pg_locks
        where locktype = 'advisory'
          and classid = ${TIER_LOCK_KEY[0]}
          and objid = ${TIER_LOCK_KEY[1]}
          and granted
      `;

      expect(held.n).toBeGreaterThan(0);

      // And a second process genuinely cannot take it. `pg_try_advisory_lock`
      // is the non-blocking form, so this asserts exclusion without risking a
      // test that hangs for two minutes when the guarantee is broken.
      const [attempt] = await observer<{ got: boolean }[]>`
        select pg_try_advisory_lock(${TIER_LOCK_KEY[0]}, ${TIER_LOCK_KEY[1]}) as got
      `;

      if (attempt.got) {
        // Do not leak the lock we just proved we should not have been given.
        await observer`select pg_advisory_unlock(${TIER_LOCK_KEY[0]}, ${TIER_LOCK_KEY[1]})`;
      }

      expect(attempt.got).toBe(false);
    } finally {
      await observer.end({ timeout: 5 });
    }
  });
});
