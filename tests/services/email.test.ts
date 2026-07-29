import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getRequiredEnv: vi.fn((key: string) => `${key}_test`),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: mocks.send,
    };
  },
}));

import { sendMail, sendVerifyEmail } from "@/services/email/send";

describe("sendVerifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({ data: { id: "email_1" } });
  });

  it("sends a verification email with a safe text fallback", async () => {
    const url = "https://app.example.com/api/auth/verify-email?token=test";

    await sendVerifyEmail("user@example.com", url);

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "EMAIL_FROM_test",
        to: ["user@example.com"],
        subject: "Verify your email",
        text: `Open this link to verify your email: ${url}`,
      })
    );
    expect(mocks.send.mock.calls[0][0].html).toContain("Verify your email");
    expect(mocks.send.mock.calls[0][0].html).toContain(url);
  });

  it("forwards durable-job identity and cancellation to Resend", async () => {
    const signal = new AbortController().signal;

    await sendMail({
      to: "user@example.com",
      subject: "Queued",
      html: "<p>Queued</p>",
      idempotencyKey: "job-7152ea1f-c2fa-4163-9af8-0b34007b76a5",
      signal,
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["user@example.com"],
        subject: "Queued",
      }),
      {
        idempotencyKey: "job-7152ea1f-c2fa-4163-9af8-0b34007b76a5",
        signal,
      },
    );
  });
});
