import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSignature: vi.fn(),
  queueTest: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/services/marketing/signature", () => ({
  requireContentStudioSignature: mocks.requireSignature,
}));
vi.mock("@/services/marketing/dispatch", () => ({
  queueMarketingTest: mocks.queueTest,
  dispatchMarketingCampaign: mocks.dispatch,
}));

import { AppError } from "@/lib/errors";
import { POST as dispatchPost } from "@/app/api/internal/marketing/dispatch/route";
import { POST as testPost } from "@/app/api/internal/marketing/test/route";

const message = {
  campaignKey: "release-2026-08",
  locale: "en",
  subject: "Release notes",
  preheader: "A short summary",
  template: {
    accentColor: "#15856f",
    pageBackgroundColor: "#f4f3ee",
    contentBackgroundColor: "#ffffff",
    footerText: "Product news",
    companyAddress: "1 Example Street",
  },
  blocks: [{ type: "text", text: "Hello", align: "left" }],
};

function request(body: unknown): Request {
  return new Request("https://app.example.com/api/internal/marketing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Content Studio marketing gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSignature.mockReset();
    mocks.queueTest.mockResolvedValue({ queued: true });
    mocks.dispatch.mockResolvedValue({ recipients: 1 });
  });

  it.each([
    [
      "test",
      testPost,
      { requestId: "test:one", recipient: "editor@example.com", message },
      mocks.queueTest,
    ],
    [
      "dispatch",
      dispatchPost,
      {
        requestId: "launch:one",
        message,
        audience: { topic: "product-updates", locale: "en" },
      },
      mocks.dispatch,
    ],
  ])("rejects an unsigned %s request before the write service", async (_name, route, body, write) => {
    mocks.requireSignature.mockImplementation(() => {
      throw new AppError("AUTH_FORBIDDEN");
    });

    const response = await route(request(body));

    expect(response.status).toBe(403);
    expect(write).not.toHaveBeenCalled();
  });

  it("queues a valid signed test through the service", async () => {
    const response = await testPost(
      request({ requestId: "test:one", recipient: "editor@example.com", message }),
    );

    expect(response.status).toBe(200);
    expect(mocks.queueTest).toHaveBeenCalledOnce();
  });
});
