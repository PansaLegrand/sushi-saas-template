/**
 * Account lifecycle route contracts.
 *
 * These assertions keep unauthenticated callers from probing request state and
 * ensure idempotency keys reach the transactional service unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitForTests } from "@/lib/rate-limit";
import { get, postJson, url } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getActor:
    vi.fn<
      typeof import("@/services/account-lifecycle").getAccountActorFromHeaders
    >(),
  requestExport:
    vi.fn<
      typeof import("@/services/account-lifecycle").requestAccountDataExport
    >(),
  exportStatus:
    vi.fn<
      typeof import("@/services/account-lifecycle").getAccountExportStatus
    >(),
  requestErasure:
    vi.fn<
      typeof import("@/services/account-lifecycle").requestAccountErasure
    >(),
  erasureStatus:
    vi.fn<
      typeof import("@/services/account-lifecycle").getAccountErasureStatus
    >(),
  cancelErasure:
    vi.fn<
      typeof import("@/services/account-lifecycle").cancelAccountErasure
    >(),
  validateKey:
    vi.fn<
      typeof import("@/services/account-lifecycle").validateAccountLifecycleIdempotencyKey
    >(),
}));

vi.mock("@/services/account-lifecycle", () => ({
  getAccountActorFromHeaders: mocks.getActor,
  requestAccountDataExport: mocks.requestExport,
  getAccountExportStatus: mocks.exportStatus,
  requestAccountErasure: mocks.requestErasure,
  getAccountErasureStatus: mocks.erasureStatus,
  cancelAccountErasure: mocks.cancelErasure,
  validateAccountLifecycleIdempotencyKey: mocks.validateKey,
}));

import { POST as requestExport } from "@/app/api/account/data-export/route";
import { GET as getExport } from "@/app/api/account/data-export/[uuid]/route";
import {
  DELETE as cancelDeletion,
  GET as getDeletion,
  POST as requestDeletion,
} from "@/app/api/account/deletion/route";

const actor = {
  userId: "user-id",
  userUuid: "user-uuid",
  email: "person@test.dev",
  lifecycleStatus: "active",
  sessionCreatedAt: new Date(),
};

const requestView = {
  uuid: "request-uuid",
  type: "export",
  status: "scheduled",
  scheduledAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  createdAt: new Date().toISOString(),
};

describe("account lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getActor.mockResolvedValue(actor);
    mocks.validateKey.mockImplementation((value) => value ?? "");
    mocks.requestExport.mockResolvedValue(requestView);
    mocks.exportStatus.mockResolvedValue(requestView);
    mocks.requestErasure.mockResolvedValue({
      ...requestView,
      type: "erasure",
    });
    mocks.erasureStatus.mockResolvedValue(null);
    mocks.cancelErasure.mockResolvedValue({ canceled: true });
  });

  it("auth-gates export creation before requesting data", async () => {
    mocks.getActor.mockResolvedValue(null);
    const res = await requestExport(
      postJson("/api/account/data-export", {}, {
        headers: { "idempotency-key": "export-key" },
      }),
    );

    expect(res.status).toBe(401);
    expect(mocks.requestExport).not.toHaveBeenCalled();
  });

  it("passes export idempotency through to the service", async () => {
    const res = await requestExport(
      postJson("/api/account/data-export", {}, {
        headers: { "idempotency-key": "export-key" },
      }),
    );

    expect(res.status).toBe(202);
    expect(mocks.requestExport).toHaveBeenCalledWith({
      actor,
      idempotencyKey: "export-key",
    });
  });

  it("auth-gates an export download before loading its state", async () => {
    mocks.getActor.mockResolvedValue(null);
    const res = await getExport(
      get("/api/account/data-export/request-uuid"),
      { params: Promise.resolve({ uuid: "request-uuid" }) },
    );

    expect(res.status).toBe(401);
    expect(mocks.exportStatus).not.toHaveBeenCalled();
  });

  it("auth-gates deletion creation before mutating lifecycle state", async () => {
    mocks.getActor.mockResolvedValue(null);
    const res = await requestDeletion(
      postJson("/api/account/deletion", {}, {
        headers: { "idempotency-key": "delete-key" },
      }),
    );

    expect(res.status).toBe(401);
    expect(mocks.requestErasure).not.toHaveBeenCalled();
  });

  it("passes deletion idempotency through to the service", async () => {
    const res = await requestDeletion(
      postJson("/api/account/deletion", {}, {
        headers: { "idempotency-key": "delete-key" },
      }),
    );

    expect(res.status).toBe(202);
    expect(mocks.requestErasure).toHaveBeenCalledWith({
      actor,
      idempotencyKey: "delete-key",
    });
  });

  it("auth-gates deletion status before reading lifecycle state", async () => {
    mocks.getActor.mockResolvedValue(null);
    const res = await getDeletion(get("/api/account/deletion"));

    expect(res.status).toBe(401);
    expect(mocks.erasureStatus).not.toHaveBeenCalled();
  });

  it("auth-gates cancellation before changing lifecycle state", async () => {
    mocks.getActor.mockResolvedValue(null);
    const res = await cancelDeletion(
      new Request(url("/api/account/deletion"), { method: "DELETE" }),
    );

    expect(res.status).toBe(401);
    expect(mocks.cancelErasure).not.toHaveBeenCalled();
  });
});
