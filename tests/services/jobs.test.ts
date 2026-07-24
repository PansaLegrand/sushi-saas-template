/**
 * Job runner semantics.
 *
 * What we test
 * - A succeeding job is marked succeeded.
 * - A failing job is retried with backoff until attempts are exhausted.
 * - An unknown job type is buried rather than retried forever.
 * - enqueueJobSafe never throws into the caller (auth hooks depend on this).
 *
 * The model layer is mocked; no database access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { claimDueJobs, markJobSucceeded, markJobFailed, insertJob } = vi.hoisted(
  () => ({
    claimDueJobs: vi.fn(),
    markJobSucceeded: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue("retrying"),
    insertJob: vi.fn().mockResolvedValue({ id: 1 }),
  })
);

vi.mock("@/models/job", () => ({
  claimDueJobs,
  markJobSucceeded,
  markJobFailed,
  insertJob,
  deleteFinishedJobsBefore: vi.fn().mockResolvedValue(undefined),
}));

const { welcomeEmail, newUserCredits } = vi.hoisted(() => ({
  welcomeEmail: vi.fn().mockResolvedValue(undefined),
  newUserCredits: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/jobs/handlers", () => ({
  jobHandlers: {
    welcome_email: welcomeEmail,
    new_user_credits: newUserCredits,
  },
}));

import { enqueueJobSafe, runDueJobs } from "@/services/jobs";

function buildJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: "job-1",
    type: "welcome_email",
    payload_json: JSON.stringify({ email: "a@example.com", name: "A" }),
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_at: new Date(),
    locked_at: new Date(),
    dedupe_key: null,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

describe("runDueJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markJobFailed.mockResolvedValue("retrying");
  });

  it("runs a claimed job and marks it succeeded", async () => {
    claimDueJobs.mockResolvedValue([buildJob()]);

    const result = await runDueJobs();

    expect(welcomeEmail).toHaveBeenCalledWith({
      email: "a@example.com",
      name: "A",
    });
    expect(markJobSucceeded).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
  });

  it("retries a failing job instead of dropping it", async () => {
    claimDueJobs.mockResolvedValue([buildJob()]);
    welcomeEmail.mockRejectedValueOnce(new Error("smtp down"));

    const result = await runDueJobs();

    expect(markJobSucceeded).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledTimes(1);
    expect(markJobFailed.mock.calls[0][1]).toBe("smtp down");
    expect(result).toMatchObject({ retrying: 1, succeeded: 0 });
  });

  it("reports a job that has exhausted its attempts as failed", async () => {
    claimDueJobs.mockResolvedValue([buildJob({ attempts: 5 })]);
    welcomeEmail.mockRejectedValueOnce(new Error("still down"));
    markJobFailed.mockResolvedValue("failed");

    const result = await runDueJobs();

    expect(result).toMatchObject({ failed: 1, retrying: 0 });
  });

  it("buries an unknown job type rather than retrying forever", async () => {
    claimDueJobs.mockResolvedValue([buildJob({ type: "removed_in_a_deploy" })]);

    const result = await runDueJobs();

    expect(result).toMatchObject({ failed: 1 });
    // Forced to max attempts so it is not rescheduled.
    expect(markJobFailed.mock.calls[0][0].attempts).toBe(5);
    expect(markJobFailed.mock.calls[0][1]).toContain("unknown job type");
  });

  it("keeps processing after one job fails", async () => {
    claimDueJobs.mockResolvedValue([
      buildJob({ id: 1, uuid: "job-1" }),
      buildJob({ id: 2, uuid: "job-2" }),
    ]);
    welcomeEmail.mockRejectedValueOnce(new Error("transient"));

    const result = await runDueJobs();

    expect(result.claimed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.retrying).toBe(1);
  });

  it("does nothing when the queue is empty", async () => {
    claimDueJobs.mockResolvedValue([]);

    const result = await runDueJobs();

    expect(result).toMatchObject({ claimed: 0, succeeded: 0 });
    expect(welcomeEmail).not.toHaveBeenCalled();
  });
});

describe("enqueueJobSafe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never throws into the caller when the insert fails", async () => {
    insertJob.mockRejectedValueOnce(new Error("db down"));

    // An auth hook must not fail a signup because queueing broke.
    await expect(
      enqueueJobSafe("welcome_email", { email: "a@example.com" })
    ).resolves.toBeUndefined();
  });

  it("passes the dedupe key through", async () => {
    await enqueueJobSafe(
      "new_user_credits",
      { userUuid: "u-1", credits: 10 },
      { dedupeKey: "new_user_credits:u-1" }
    );

    expect(insertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "new_user_credits",
        dedupeKey: "new_user_credits:u-1",
      })
    );
  });
});
