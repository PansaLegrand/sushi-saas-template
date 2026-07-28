/**
 * Resolving a parked Stripe event from the console.
 *
 * The write half of `/stripe-events`, and the properties worth pinning are the
 * ones that keep it honest rather than the ones that make it work: a read-only
 * admin cannot press it, a resolution with no reason is refused, and a refusal
 * from the model's status guard is reported as a status conflict rather than as
 * a success. That last one matters because the operation's whole value is the
 * trail it leaves — an endpoint that answers 200 when it changed nothing would
 * make the queue look emptied while the row stayed parked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { respForbidden, respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminWrite: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  resolveStripeWebhookEvent: vi.fn(),
  findStripeWebhookEventById: vi.fn(),
}));

vi.mock("@admin/lib/authz", () => ({
  requireAdminWrite: mocks.requireAdminWrite,
}));

vi.mock("@admin/lib/origin", () => ({
  requireSameOrigin: () => undefined,
}));

vi.mock("@admin/lib/audit", () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}));

vi.mock("@/models/stripe-webhook-event", () => ({
  resolveStripeWebhookEvent: mocks.resolveStripeWebhookEvent,
  findStripeWebhookEventById: mocks.findStripeWebhookEventById,
}));

import { POST as resolve } from "@admin/app/api/admin/stripe-events/[eventId]/resolve/route";

const params = (eventId: string) => ({ params: Promise.resolve({ eventId }) });

const writeAdmin = {
  userId: "id-admin",
  userUuid: "u-admin",
  email: "admin@example.com",
  role: "admin_rw" as const,
};

function jsonRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const resolvedRow = {
  event_id: "evt_1",
  event_type: "invoice.payment_succeeded",
  status: "resolved",
  attempts: 2,
  last_error: "unmapped_price (stripe_price_id=price_x)",
  stripe_invoice_id: "in_1",
  stripe_subscription_id: "sub_1",
  resolved_at: new Date("2026-07-28T10:00:00.000Z"),
};

const url = "http://admin.test/api/admin/stripe-events/evt_1/resolve";

describe("admin stripe event resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWrite.mockResolvedValue(writeAdmin);
    mocks.resolveStripeWebhookEvent.mockResolvedValue(resolvedRow);
    mocks.writeAdminAuditLog.mockResolvedValue(undefined);
  });

  it("refuses a resolve from a read-only admin", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respForbidden());

    const res = await resolve(
      jsonRequest(url, { note: "handled" }),
      params("evt_1")
    );

    expect(res.status).toBe(403);
    expect(mocks.resolveStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request before touching the row", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respNoAuth());

    const res = await resolve(
      jsonRequest(url, { note: "handled" }),
      params("evt_1")
    );

    expect(res.status).toBe(401);
    expect(mocks.resolveStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("refuses a resolution with no reason", async () => {
    // The note is the entire audit value. "Somebody closed it" answers nothing
    // six months later, which is exactly when it gets asked.
    const res = await resolve(jsonRequest(url, { note: "   " }), params("evt_1"));

    expect(res.status).toBe(400);
    expect(mocks.resolveStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("records who closed it, and what it was parked for", async () => {
    const res = await resolve(
      jsonRequest(url, { note: "Refunded in Stripe on the 3rd." }),
      params("evt_1")
    );

    expect(res.status).toBe(200);
    expect(mocks.resolveStripeWebhookEvent).toHaveBeenCalledWith({
      eventId: "evt_1",
      actorUuid: "u-admin",
      note: "Refunded in Stripe on the 3rd.",
    });

    const entry = mocks.writeAdminAuditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "stripe_event.resolve",
      targetType: "stripe_webhook_event",
      targetUuid: "evt_1",
      note: "Refunded in Stripe on the 3rd.",
    });
    // The parked reason travels into the trail. The row keeps it too, but the
    // audit entry is the one that survives the row being reclaimed later.
    expect(entry.metadata.previousError).toContain("unmapped_price");
  });

  it("reports a status conflict rather than claiming a resolve that did not happen", async () => {
    // The model's WHERE refused it — the event completed, or a redelivery
    // reclaimed it between the operator loading the page and clicking.
    mocks.resolveStripeWebhookEvent.mockResolvedValue(undefined);
    mocks.findStripeWebhookEventById.mockResolvedValue({
      event_id: "evt_1",
      status: "completed",
    });

    const res = await resolve(
      jsonRequest(url, { note: "handled" }),
      params("evt_1")
    );
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.details?.status).toBe("completed");
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("reports an unknown event as not found, not as a status conflict", async () => {
    // Two different problems: one sends the operator to check the id, the other
    // to reload the page.
    mocks.resolveStripeWebhookEvent.mockResolvedValue(undefined);
    mocks.findStripeWebhookEventById.mockResolvedValue(undefined);

    const res = await resolve(
      jsonRequest(url, { note: "handled" }),
      params("evt_1")
    );

    expect(res.status).toBe(404);
  });

  it("records a failed resolve rather than losing the attempt", async () => {
    mocks.resolveStripeWebhookEvent.mockRejectedValue(new Error("db down"));

    const res = await resolve(
      jsonRequest(url, { note: "handled" }),
      params("evt_1")
    );

    expect(res.status).toBe(500);
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stripe_event.resolve",
        status: "failed",
        errorMessage: "db down",
      })
    );
  });
});
