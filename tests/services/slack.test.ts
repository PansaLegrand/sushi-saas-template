import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import { sendSlackMessage } from "@/integrations/slack";

describe("Slack webhook delivery", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/services/test");
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
    vi.restoreAllMocks();
  });

  it("resolves only after Slack accepts the message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await expect(
      sendSlackMessage("Payment succeeded"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects rate limits and provider failures so the durable job retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("slow down", {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );

    await expect(sendSlackMessage("Payment succeeded")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
