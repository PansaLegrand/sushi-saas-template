import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger/server", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { runJobWorker } from "@/services/jobs/worker";

function emptyResult(claimed = 0) {
  return {
    claimed,
    succeeded: claimed,
    retrying: 0,
    failed: 0,
    leaseLost: 0,
    results: [],
  };
}

describe("portable job worker", () => {
  const run = vi.fn();
  const maintain = vi.fn();
  const now = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    run.mockResolvedValue(emptyResult());
    maintain.mockResolvedValue({ finishedJobsPruned: 0 });
    now.mockReturnValue(60 * 60 * 1000);
  });

  it("runs one bounded cycle and performs recurring maintenance", async () => {
    await runJobWorker(
      { signal: new AbortController().signal, once: true, batchSize: 7 },
      { run, maintain, now },
    );

    expect(run).toHaveBeenCalledWith(7, {
      handlerTimeoutMs: 20_000,
      drainDeadlineMs: 40_000,
      signal: expect.any(AbortSignal),
    });
    expect(maintain).toHaveBeenCalledWith(new Date(60 * 60 * 1000));
  });

  it("immediately continues after a full batch", async () => {
    const controller = new AbortController();
    run
      .mockResolvedValueOnce(emptyResult(2))
      .mockImplementationOnce(async () => {
        controller.abort();
        return emptyResult();
      });

    await runJobWorker(
      {
        signal: controller.signal,
        batchSize: 2,
        pollIntervalMs: 60_000,
      },
      { run, maintain, now },
    );

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("wakes an idle worker immediately for graceful shutdown", async () => {
    const controller = new AbortController();
    const worker = runJobWorker(
      { signal: controller.signal, pollIntervalMs: 60_000 },
      { run, maintain, now },
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    controller.abort();
    await expect(worker).resolves.toBeUndefined();
  });

  it("fails a one-shot invocation when the queue cannot be read", async () => {
    run.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      runJobWorker(
        { signal: new AbortController().signal, once: true },
        { run, maintain, now },
      ),
    ).rejects.toThrow("database unavailable");
  });
});
