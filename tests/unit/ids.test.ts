/**
 * Identifier generation.
 *
 * These ids land in columns with unique indexes — `orders.order_no`,
 * `credits.trans_no`, `reservations.reservation_no` — so a collision is not data
 * corruption. It is a failed insert on a financial record, shown to whoever was
 * mid-checkout, at precisely the traffic levels that produce concurrent
 * instances. The generator this replaced failed exactly there: every serverless
 * lambda defaulted to snowflake worker id 1.
 *
 * A generator cannot be tested for "never collides", so these pin the properties
 * that make collisions structurally unlikely: real v7 layout (the randomness is
 * where the spec says it is), no shared counter, and enough entropy in the short
 * code that the uniqueness retry is a formality rather than the mechanism.
 */
import { describe, expect, it } from "vitest";

import { newId, newShortCode } from "@/lib/ids";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("produces a well-formed UUIDv7", () => {
    // The `7` and the `[89ab]` are the version and variant nibbles. Checking them
    // rather than a loose uuid shape is what distinguishes v7 from v4 — and the
    // version is the part that promises the timestamp prefix relied on below.
    expect(newId()).toMatch(UUID_V7);
  });

  it("does not repeat across a burst from one process", () => {
    // A tight loop is the case a millisecond-timestamped id has to handle: many
    // ids inside one clock tick, where only the random bits differ.
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));

    expect(ids.size).toBe(10_000);
  });

  it("sorts lexicographically by creation time", () => {
    // What v7 buys over v4, and why it was chosen: the leading timestamp keeps
    // B-tree inserts local, and keeps the debugging habit that adjacent ids were
    // created at about the same time.
    const before = newId();
    const start = Date.now();
    while (Date.now() === start) {
      // Wait out the millisecond deliberately. RFC 9562 only guarantees ordering
      // *across* milliseconds; keeping ids monotonic within one is an optional
      // extra that this `uuid` version happens to implement with a counter. The
      // test pins the guaranteed property, so an implementation change cannot
      // break it for a reason that was never promised.
    }
    const after = newId();

    expect(before < after).toBe(true);
  });

  it("fits the varchar(255) columns it is written to", () => {
    expect(newId()).toHaveLength(36);
  });
});

describe("newShortCode", () => {
  it("honours the requested length", () => {
    expect(newShortCode(8)).toHaveLength(8);
    expect(newShortCode(4)).toHaveLength(4);
    expect(newShortCode()).toHaveLength(8);
  });

  it("omits characters that are misread when typed by hand", () => {
    // These codes are read off a screen and retyped, so `I`/`L`/`O` are out for
    // being `1` and `0` in most fonts. `U` is out to avoid generating a code that
    // reads as an obscenity.
    const sample = Array.from({ length: 500 }, () => newShortCode(16)).join("");

    expect(sample).not.toMatch(/[ILOU]/);
    expect(sample).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it("varies in its leading characters, not just its last ones", () => {
    // The regression this guards. The old invite code was
    // `parseInt(snowflakeId).toString(36).slice(-8)`, so consecutive codes shared
    // a prefix and differed only at the tail — which meant one real invite code
    // told you roughly what the next ones would be, and these codes pay an
    // attribution reward. A distribution check catches that; a format check does
    // not.
    const firstChars = new Set(
      Array.from({ length: 200 }, () => newShortCode(8)[0])
    );

    expect(firstChars.size).toBeGreaterThan(10);
  });

  it("does not repeat across a large sample", () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => newShortCode(8)));

    // ~40 bits of space, so a duplicate in 20k draws would mean the generator is
    // not drawing uniformly rather than that the space ran out.
    expect(codes.size).toBe(20_000);
  });
});
