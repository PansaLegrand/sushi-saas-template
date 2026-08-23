import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { respForbidden, respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminWrite: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  retryFailedJob: vi.fn(),
  cancelPendingJob: vi.fn(),
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
vi.mock("@/services/jobs/operator", () => ({
  retryFailedJob: mocks.retryFailedJob,
  cancelPendingJob: mocks.cancelPendingJob,
}));

import { POST } from "@admin/app/api/admin/jobs/[uuid]/route";

const admin = {
  userId: "admin-id",
  userUuid: "admin-uuid",
  email: "admin@example.test",
  role: "admin_rw" as const,
  mfaEnabled: true,
};
const params = { params: Promise.resolve({ uuid: "job-1" }) };

function request(body: unknown) {
  return new Request("http://admin.test/api/admin/jobs/job-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function job(status: string) {
  return {
    uuid: "job-1",
    type: "welcome_email",
    status,
    attempts: status === "pending" ? 0 : 5,
    max_attempts: 5,
  };
}

describe("admin job operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWrite.mockResolvedValue(admin);
    mocks.writeAdminAuditLog.mockResolvedValue(undefined);
    mocks.retryFailedJob.mockResolvedValue(job("pending"));
    mocks.cancelPendingJob.mockResolvedValue(job("canceled"));
  });

  it("rejects unauthenticated and read-only admins before touching jobs", async () => {
    mocks.requireAdminWrite.mockResolvedValueOnce(respNoAuth());
    expect(
      (await POST(request({ action: "retry", note: "safe" }), params)).status,
    ).toBe(401);

    mocks.requireAdminWrite.mockResolvedValueOnce(respForbidden());
    expect(
      (await POST(request({ action: "retry", note: "safe" }), params)).status,
    ).toBe(403);

    expect(mocks.retryFailedJob).not.toHaveBeenCalled();
    expect(mocks.cancelPendingJob).not.toHaveBeenCalled();
  });

  it("requires an operator note before changing state", async () => {
    const response = await POST(
      request({ action: "cancel", note: "   " }),
      params,
    );

    expect(response.status).toBe(400);
    expect(mocks.cancelPendingJob).not.toHaveBeenCalled();
  });

  it("retries through the service and records an audit entry", async () => {
    const response = await POST(
      request({ action: "retry", note: "Provider recovered" }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.retryFailedJob).toHaveBeenCalledWith("job-1");
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: admin,
        action: "job.retry",
        targetType: "job",
        targetUuid: "job-1",
        note: "Provider recovered",
      }),
    );
  });

  it("cancels only through the pending-job service", async () => {
    const response = await POST(
      request({ action: "cancel", note: "Request withdrawn" }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.cancelPendingJob).toHaveBeenCalledWith("job-1");
    expect(mocks.retryFailedJob).not.toHaveBeenCalled();
  });

  it("reports a stale page and records the refused operation", async () => {
    mocks.retryFailedJob.mockRejectedValueOnce(
      new AppError("JOB_STATE_CONFLICT", {
        details: { field: "status", expected: "failed", actual: "succeeded" },
      }),
    );

    const response = await POST(
      request({ action: "retry", note: "Provider recovered" }),
      params,
    );

    expect(response.status).toBe(409);
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.retry", status: "failed" }),
    );
  });
});
