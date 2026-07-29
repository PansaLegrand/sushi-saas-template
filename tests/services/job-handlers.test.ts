/**
 * Provider-facing job identity.
 *
 * A worker may lose the response after Resend accepted a message. Every retry
 * must therefore reuse one provider idempotency key derived from the durable
 * job UUID, never from the attempt number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  welcome: vi.fn(),
  invitation: vi.fn(),
  paymentSuccess: vi.fn(),
  paymentFailed: vi.fn(),
  reservation: vi.fn(),
}));

vi.mock("@/services/email/send", () => ({
  sendWelcomeEmail: mocks.welcome,
  sendOrgInvitationEmail: mocks.invitation,
  sendPaymentSuccessEmail: mocks.paymentSuccess,
  sendPaymentFailedEmail: mocks.paymentFailed,
  sendReservationConfirmedEmail: mocks.reservation,
}));

vi.mock("@/integrations/slack", () => ({
  sendSlackMessage: vi.fn(),
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: { NewUser: "new_user" },
  increaseCredits: vi.fn(),
  getOrgCreditSummary: vi.fn(),
}));

vi.mock("@/models/organization", () => ({
  findPersonalOrganizationByUserUuid: vi.fn(),
}));

vi.mock("@/services/storage/delete-worker", () => ({
  deleteStoredObject: vi.fn(),
}));

import { jobHandlers } from "@/services/jobs/handlers";
import type { JobHandlerContext } from "@/services/jobs/types";

function context(attempt: number): JobHandlerContext {
  return {
    jobUuid: "7152ea1f-c2fa-4163-9af8-0b34007b76a5",
    attempt,
    maxAttempts: 5,
    signal: new AbortController().signal,
  };
}

describe("queued mail handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const send of Object.values(mocks)) {
      send.mockResolvedValue(undefined);
    }
  });

  it("passes one stable Resend idempotency key to every mail side effect", async () => {
    const execution = context(1);
    const delivery = {
      idempotencyKey: `job-${execution.jobUuid}`,
      signal: execution.signal,
    };

    await jobHandlers.welcome_email(
      { email: "person@example.com", name: "Person" },
      execution,
    );
    await jobHandlers.org_invitation_email(
      {
        to: "invitee@example.com",
        url: "https://app.example.com/invitations/invite-1",
        organizationName: "Example",
      },
      execution,
    );
    await jobHandlers.payment_success_email(
      { to: "payer@example.com", orderNo: "order-1" },
      execution,
    );
    await jobHandlers.payment_failed_email(
      { to: "payer@example.com", invoiceNumber: "invoice-1" },
      execution,
    );
    await jobHandlers.reservation_confirmed_email(
      {
        to: "guest@example.com",
        reservationNo: "reservation-1",
      },
      execution,
    );

    expect(mocks.welcome).toHaveBeenCalledWith(
      "person@example.com",
      "Person",
      delivery,
    );
    expect(mocks.invitation).toHaveBeenCalledWith(
      "invitee@example.com",
      expect.any(Object),
      delivery,
    );
    expect(mocks.paymentSuccess).toHaveBeenCalledWith(
      "payer@example.com",
      expect.any(Object),
      delivery,
    );
    expect(mocks.paymentFailed).toHaveBeenCalledWith(
      "payer@example.com",
      expect.any(Object),
      delivery,
    );
    expect(mocks.reservation).toHaveBeenCalledWith(
      "guest@example.com",
      expect.any(Object),
      delivery,
    );
  });

  it("does not change the provider key when the attempt changes", async () => {
    await jobHandlers.welcome_email(
      { email: "person@example.com" },
      context(1),
    );
    await jobHandlers.welcome_email(
      { email: "person@example.com" },
      context(2),
    );

    expect(mocks.welcome.mock.calls[0]?.[2].idempotencyKey).toBe(
      mocks.welcome.mock.calls[1]?.[2].idempotencyKey,
    );
  });
});
