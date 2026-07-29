/**
 * The production migration runner must distinguish ordinary pending work from
 * edited history or an accidentally selected older release.
 */
import { describe, expect, it } from "vitest";

import { inspectMigrationState } from "../../scripts/migration-state.mjs";

const expected = [
  { folderMillis: 100, hash: "hash-a", tag: "0000_alpha" },
  { folderMillis: 200, hash: "hash-b", tag: "0001_beta" },
];

describe("production migration state", () => {
  it("recognizes a current database", () => {
    expect(inspectMigrationState(expected, expected)).toEqual({
      status: "current",
      pending: [],
    });
  });

  it("returns the unapplied repository suffix", () => {
    expect(inspectMigrationState(expected.slice(0, 1), expected)).toEqual({
      status: "pending",
      pending: [expected[1]],
    });
  });

  it("rejects edited or reordered migration history", () => {
    expect(
      inspectMigrationState(
        [{ folderMillis: 100, hash: "edited", tag: "0000_alpha" }],
        expected,
      ),
    ).toMatchObject({
      status: "diverged",
      reason: expect.stringContaining("different SQL hash"),
    });

    expect(
      inspectMigrationState(
        [{ folderMillis: 200, hash: "hash-b", tag: "0001_beta" }],
        expected,
      ),
    ).toMatchObject({
      status: "diverged",
      reason: expect.stringContaining("marker"),
    });
  });

  it("rejects an older checkout against a newer database", () => {
    expect(inspectMigrationState(expected, expected.slice(0, 1))).toMatchObject({
      status: "diverged",
      reason: expect.stringContaining("older artifact"),
    });
  });
});
