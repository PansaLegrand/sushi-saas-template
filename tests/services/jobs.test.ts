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
    markJobSucceeded: vi.fn().mockResolvedValue(true),
    markJobFailed: vi.fn().mockResolvedValue("retrying"),
    insertJob: vi.fn().mockResolvedValue({ id: 1 }),
  }),
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
    subject_user_uuid: null,
    subject_org_uuid: null,
    ...overrides,
  };
}

function queueClaims(...jobs: ReturnType<typeof buildJob>[]) {
  for (const job of jobs) {
    claimDueJobs.mockResolvedValueOnce([job]);
  }
  claimDueJobs.mockResolvedValue([]);
}

describe("runDueJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimDueJobs.mockReset();
    claimDueJobs.mockResolvedValue([]);
    welcomeEmail.mockReset();
    welcomeEmail.mockResolvedValue(undefined);
    newUserCredits.mockReset();
    newUserCredits.mockResolvedValue(undefined);
    markJobSucceeded.mockReset();
    markJobSucceeded.mockResolvedValue(true);
    markJobFailed.mockReset();
    markJobFailed.mockResolvedValue("retrying");
  });

  it("runs a claimed job with stable retry context and marks it succeeded", async () => {
    queueClaims(buildJob({ attempts: 2 }));

    const result = await runDueJobs();

    expect(welcomeEmail).toHaveBeenCalledWith(
      {
        email: "a@example.com",
        name: "A",
      },
      expect.objectContaining({
        jobUuid: "job-1",
        attempt: 2,
        maxAttempts: 5,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(claimDueJobs).toHaveBeenCalledWith(1, expect.any(Number));
    expect(markJobSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, locked_at: expect.any(Date) }),
    );
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
  });

  it("retries a failing job instead of dropping it", async () => {
    queueClaims(buildJob());
    welcomeEmail.mockRejectedValueOnce(new Error("smtp down"));

    const result = await runDueJobs();

    expect(markJobSucceeded).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledTimes(1);
    expect(markJobFailed.mock.calls[0][1]).toBe("smtp down");
    expect(result).toMatchObject({ retrying: 1, succeeded: 0 });
  });

  it("reports a job that has exhausted its attempts as failed", async () => {
    queueClaims(buildJob({ attempts: 5 }));
    welcomeEmail.mockRejectedValueOnce(new Error("still down"));
    markJobFailed.mockResolvedValue("failed");

    const result = await runDueJobs();

    expect(result).toMatchObject({ failed: 1, retrying: 0 });
  });

  it("buries an unknown job type rather than retrying forever", async () => {
    queueClaims(buildJob({ type: "removed_in_a_deploy" }));

    const result = await runDueJobs();

    expect(result).toMatchObject({ failed: 1 });
    // Forced to max attempts so it is not rescheduled.
    expect(markJobFailed.mock.calls[0][0].attempts).toBe(5);
    expect(markJobFailed.mock.calls[0][1]).toContain("unknown job type");
  });

  it("keeps processing after one job fails", async () => {
    queueClaims(
      buildJob({ id: 1, uuid: "job-1" }),
      buildJob({ id: 2, uuid: "job-2" }),
    );
    welcomeEmail.mockRejectedValueOnce(new Error("transient"));

    const result = await runDueJobs();

    expect(result.claimed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.retrying).toBe(1);
  });

  it("does nothing when the queue is empty", async () => {
    const result = await runDueJobs();

    expect(result).toMatchObject({ claimed: 0, succeeded: 0 });
    expect(welcomeEmail).not.toHaveBeenCalled();
  });

  it("does not report success after another runner replaces its lease", async () => {
    queueClaims(buildJob());
    markJobSucceeded.mockResolvedValueOnce(false);

    const result = await runDueJobs();

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      results: [expect.objectContaining({ outcome: "lease_lost" })],
    });
  });

  it("never preclaims the next job while the current handler is running", async () => {
    let finish: (() => void) | undefined;
    welcomeEmail.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    queueClaims(
      buildJob({ id: 1, uuid: "job-1" }),
      buildJob({ id: 2, uuid: "job-2" }),
    );

    const drain = runDueJobs(2);
    await vi.waitFor(() => expect(welcomeEmail).toHaveBeenCalledOnce());

    expect(claimDueJobs).toHaveBeenCalledTimes(1);
    expect(claimDueJobs).toHaveBeenLastCalledWith(1, expect.any(Number));

    finish?.();
    await drain;
    expect(claimDueJobs).toHaveBeenCalledTimes(2);
  });

  it("aborts and retries a handler that exceeds its timeout", async () => {
    let signal: AbortSignal | undefined;
    welcomeEmail.mockImplementationOnce((_payload, context) => {
      signal = context.signal;
      return new Promise<void>(() => {});
    });
    queueClaims(buildJob());

    const result = await runDueJobs(1, {
      handlerTimeoutMs: 10,
      drainDeadlineMs: 100,
    });

    expect(signal?.aborted).toBe(true);
    expect(markJobSucceeded).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "job-1" }),
      "job handler timed out after 10ms",
      expect.any(Number),
    );
    expect(result).toMatchObject({ claimed: 1, retrying: 1 });
  });

  it("releases a lease when the claim itself crosses the drain deadline", async () => {
    claimDueJobs.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return [buildJob()];
    });

    const result = await runDueJobs(2, {
      handlerTimeoutMs: 100,
      drainDeadlineMs: 5,
    });

    expect(welcomeEmail).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "job-1" }),
      "job drain deadline elapsed immediately after claim",
      expect.any(Number),
    );
    expect(claimDueJobs).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ claimed: 1, retrying: 1 });
  });
});

describe("enqueueJobSafe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never throws into the caller when the insert fails", async () => {
    insertJob.mockRejectedValueOnce(new Error("db down"));

    // An auth hook must not fail a signup because queueing broke. It reports
    // `false` rather than nothing, so a caller that tells someone "I queued an
    // alert" can tell the difference between having done so and not.
    await expect(
      enqueueJobSafe("welcome_email", { email: "a@example.com" }),
    ).resolves.toBe(false);
  });

  it("reports whether a job was actually created", async () => {
    // `insertJob` returns undefined when a dedupe key already had a job, so a
    // successful call is not the same as a created job. The Stripe sweep reports
    // "alerted" from this: within one dedupe window the message is suppressed,
    // and claiming to have sent it would be a lie told to whoever is on call.
    insertJob.mockResolvedValueOnce({ uuid: "job-1" });
    await expect(
      enqueueJobSafe("welcome_email", { email: "a@example.com" }),
    ).resolves.toBe(true);

    insertJob.mockResolvedValueOnce(undefined);
    await expect(
      enqueueJobSafe("welcome_email", { email: "a@example.com" }),
    ).resolves.toBe(false);
  });

  it("passes the dedupe key through", async () => {
    await enqueueJobSafe(
      "new_user_credits",
      { userUuid: "u-1", credits: 10 },
      {
        dedupeKey: "new_user_credits:u-1",
        retryFailed: true,
        subjectUserUuid: "u-1",
      },
    );

    expect(insertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "new_user_credits",
        dedupeKey: "new_user_credits:u-1",
        retryFailed: true,
        subjectUserUuid: "u-1",
      }),
    );
  });
});
