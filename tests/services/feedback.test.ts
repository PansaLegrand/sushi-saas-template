/**
 * Feedback state is server-owned. This test prevents a route refactor from
 * accidentally exposing status or creation time as client-controlled fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertFeedback: vi.fn<typeof import("@/models/feedback").insertFeedback>(),
}));

vi.mock("@/models/feedback", () => ({
  insertFeedback: mocks.insertFeedback,
}));

import { submitFeedback } from "@/services/feedback";

describe("submitFeedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owns workflow state and timestamp at the service boundary", async () => {
    mocks.insertFeedback.mockResolvedValue({
      id: 17,
      created_at: null,
      status: "new",
      user_uuid: "user-1",
      content: "Useful starter",
      rating: 5,
    });

    await submitFeedback({
      userUuid: "user-1",
      content: "Useful starter",
      rating: 5,
    });

    expect(mocks.insertFeedback).toHaveBeenCalledWith({
      user_uuid: "user-1",
      content: "Useful starter",
      rating: 5,
      status: "new",
      created_at: expect.any(Date),
    });
  });
});
