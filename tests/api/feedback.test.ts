/**
 * Feedback is a write endpoint. These tests prove authentication and validation
 * finish before its service can persist user-controlled content.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getUserUuid: vi.fn<typeof import("@/services/user").getUserUuid>(),
  submitFeedback: vi.fn<typeof import("@/services/feedback").submitFeedback>(),
}));

vi.mock("@/services/user", () => ({ getUserUuid: mocks.getUserUuid }));
vi.mock("@/services/feedback", () => ({
  submitFeedback: mocks.submitFeedback,
}));

import { POST } from "@/app/api/feedback/route";

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getUserUuid.mockResolvedValue("user-1");
    mocks.submitFeedback.mockResolvedValue({
      id: 17,
      created_at: null,
      status: "new",
      user_uuid: "user-1",
      content: "Useful starter",
      rating: 5,
    });
  });

  it("rejects an anonymous request before writing feedback", async () => {
    mocks.getUserUuid.mockResolvedValue(null);

    const response = await POST(
      postJson("/api/feedback", { content: "Useful starter" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.submitFeedback).not.toHaveBeenCalled();
  });

  it("validates and delegates server-owned feedback state", async () => {
    const response = await POST(
      postJson("/api/feedback", {
        content: "  Useful starter  ",
        rating: "5",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: 17 } });
    expect(mocks.submitFeedback).toHaveBeenCalledWith({
      userUuid: "user-1",
      content: "Useful starter",
      rating: 5,
    });
  });

  it("rejects invalid content before invoking the service", async () => {
    const response = await POST(
      postJson("/api/feedback", { content: "x", rating: 5 }),
    );

    expect(response.status).toBe(400);
    expect(mocks.submitFeedback).not.toHaveBeenCalled();
  });
});
