/**
 * Account erasure orchestration.
 *
 * Provider calls cannot join the database transaction, so these tests prove
 * every subscription is canceled and a failed object deletion prevents local
 * finalization instead of producing a false "completed" account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  getPlan: vi.fn(),
  getExportData: vi.fn(),
  findRequest: vi.fn(),
  recordEffect: vi.fn(),
  finalize: vi.fn(),
  completeExport: vi.fn(),
  prepareExport: vi.fn(),
  markFailed: vi.fn(),
  parseState: vi.fn(),
  cancelSubscription: vi.fn(),
  cancelCustomerSubscriptions: vi.fn(),
  deleteCustomer: vi.fn(),
  deleteStoredObject: vi.fn(),
  deleteTaskOutput: vi.fn(),
  storageDelete: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/models/user", () => ({
  findUserById: vi.fn(),
}));

vi.mock("@/models/account-lifecycle", () => ({
  beginPrivacyRequest: mocks.begin,
  cancelScheduledErasure: vi.fn(),
  clearExpiredAccountExportArtifact: vi.fn(),
  completeAccountExport: mocks.completeExport,
  createPrivacyRequest: vi.fn(),
  finalizeAccountErasure: mocks.finalize,
  findLatestErasureForUser: vi.fn(),
  findPrivacyRequestByUuid: mocks.findRequest,
  findPrivacyRequestForUser: vi.fn(),
  getAccountErasurePlan: mocks.getPlan,
  getAccountExportData: mocks.getExportData,
  markPrivacyRequestFailed: mocks.markFailed,
  parsePrivacyExternalState: mocks.parseState,
  prepareAccountExportArtifact: mocks.prepareExport,
  recordPrivacyExternalEffect: mocks.recordEffect,
}));

vi.mock("@/services/stripe/account-erasure", () => ({
  cancelStripeSubscriptionForErasure: mocks.cancelSubscription,
  cancelStripeCustomerSubscriptionsForErasure:
    mocks.cancelCustomerSubscriptions,
  deleteStripeCustomerForErasure: mocks.deleteCustomer,
}));

vi.mock("@/services/storage/delete-worker", () => ({
  deleteStoredObject: mocks.deleteStoredObject,
}));

vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({
    deleteObject: mocks.storageDelete,
    getDefaultBucket: () => "private",
    putObject: mocks.storagePut,
  }),
}));

vi.mock("@/services/account-lifecycle/external-data", () => ({
  deleteTaskOutputForErasure: mocks.deleteTaskOutput,
}));

import {
  runAccountDataExport,
  runAccountErasure,
} from "@/services/account-lifecycle";

const now = new Date("2026-01-01T00:00:00.000Z");
const request = {
  id: 1,
  uuid: "request-1",
  request_type: "erasure",
  user_id: "user-id",
  user_uuid: "user-uuid",
  status: "processing",
  idempotency_key: "key",
  request_fingerprint: "fingerprint",
  erased_subject_uuid: "erased-user",
  scheduled_at: now,
  started_at: now,
  completed_at: null,
  canceled_at: null,
  attempts: 1,
  blockers_json: null,
  external_state_json: null,
  last_error: null,
  export_bucket: null,
  export_key: null,
  export_size: null,
  export_sha256: null,
  export_expires_at: null,
  created_at: now,
  updated_at: now,
};

const user = {
  id: "user-id",
  uuid: "user-uuid",
  email: "person@test.dev",
};

function emptyState() {
  return {
    stripeSubscriptions: [],
    stripeCustomers: [],
    storageFiles: [],
    exportArtifacts: [],
    taskOutputs: [],
  };
}

function plan() {
  return {
    request,
    user,
    blockers: [],
    teardownOrganizations: [],
    sharedMemberships: [],
    stripeSubscriptions: [
      {
        stripe_subscription_id: "sub_1",
      },
      {
        stripe_subscription_id: "sub_2",
      },
    ],
    stripeCustomerIds: ["cus_1"],
    storedFiles: [
      {
        uuid: "file-1",
        org_uuid: "org-1",
      },
    ],
    taskOutputs: [
      {
        uuid: "task-1",
        output_url: "/local-demo.mp4",
        output_json: null,
        org_uuid: "org-1",
      },
    ],
    exportArtifacts: [
      {
        requestUuid: "export-1",
        bucket: "private",
        key: "account-exports/export-1/account-data.json",
      },
    ],
  };
}

describe("runAccountErasure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.begin.mockResolvedValue({ outcome: "started", request, user });
    mocks.getPlan.mockResolvedValue(plan());
    mocks.prepareExport.mockResolvedValue(true);
    mocks.completeExport.mockResolvedValue(true);
    mocks.parseState.mockReturnValue(emptyState());
    mocks.cancelCustomerSubscriptions.mockResolvedValue(["sub_3"]);
    mocks.finalize.mockResolvedValue("completed");
  });

  it("cancels every local and Stripe-discovered subscription before the customer", async () => {
    await runAccountErasure({ requestUuid: request.uuid });

    expect(mocks.cancelSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.cancelSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub_1",
      requestUuid: request.uuid,
    });
    expect(mocks.cancelSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub_2",
      requestUuid: request.uuid,
    });
    expect(mocks.cancelCustomerSubscriptions).toHaveBeenCalledWith({
      customerId: "cus_1",
      requestUuid: request.uuid,
    });
    expect(mocks.deleteCustomer).toHaveBeenCalledWith({
      customerId: "cus_1",
      requestUuid: request.uuid,
    });

    const customerDeleteOrder =
      mocks.deleteCustomer.mock.invocationCallOrder[0];
    expect(
      Math.max(
        ...mocks.cancelSubscription.mock.invocationCallOrder,
        ...mocks.cancelCustomerSubscriptions.mock.invocationCallOrder,
      ),
    ).toBeLessThan(customerDeleteOrder);

    expect(mocks.deleteStoredObject).toHaveBeenCalledWith({
      fileUuid: "file-1",
      orgUuid: "org-1",
    });
    expect(mocks.deleteTaskOutput).toHaveBeenCalled();
    expect(mocks.storageDelete).toHaveBeenCalledWith({
      bucket: "private",
      key: "account-exports/export-1/account-data.json",
    });
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("does not finalize when durable storage deletion fails", async () => {
    mocks.deleteStoredObject.mockRejectedValueOnce(
      new Error("storage provider unavailable"),
    );

    await expect(
      runAccountErasure({ requestUuid: request.uuid }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LIFECYCLE_FAILED" });

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledWith(
      request.uuid,
      expect.stringContaining("storage provider unavailable"),
    );
  });

  it("does not finalize when a provider-specific task eraser fails", async () => {
    mocks.deleteTaskOutput.mockRejectedValueOnce(
      new Error("provider deletion was not confirmed"),
    );

    await expect(
      runAccountErasure({ requestUuid: request.uuid }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LIFECYCLE_FAILED" });

    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledOnce();
  });
});

describe("runAccountDataExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.begin.mockResolvedValue({
      outcome: "started",
      request: { ...request, request_type: "export" },
      user,
    });
    mocks.getExportData.mockResolvedValue({
      snapshot: {
        profile: { uuid: user.uuid, email: user.email },
        organizations: [],
        invitations: [],
        orders: [],
        credits: [],
        affiliates: [],
        affiliateDeduplicationArchive: [],
        feedback: [],
        reservations: [],
        files: [],
        tasks: [],
        authenticationHistory: [],
        subscriptions: [],
        auditHistory: [],
        privacyRequests: [],
      },
      fileObjects: [],
    });
    mocks.prepareExport.mockResolvedValue(true);
    mocks.completeExport.mockResolvedValue(true);
  });

  it("durably registers cleanup before uploading the private manifest", async () => {
    await runAccountDataExport({ requestUuid: request.uuid });

    expect(mocks.prepareExport).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUuid: request.uuid,
        bucket: "private",
        key: `account-exports/${request.uuid}/account-data.json`,
      }),
    );
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "private",
        key: `account-exports/${request.uuid}/account-data.json`,
        contentType: "application/json",
      }),
    );
    expect(mocks.completeExport).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUuid: request.uuid,
        bucket: "private",
      }),
    );
    expect(mocks.prepareExport.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.storagePut.mock.invocationCallOrder[0],
    );
    expect(mocks.storagePut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completeExport.mock.invocationCallOrder[0],
    );

    const uploaded = mocks.storagePut.mock.calls[0]?.[0] as {
      body: Uint8Array;
    };
    const document = JSON.parse(new TextDecoder().decode(uploaded.body));
    expect(document.data.profile).toEqual({
      uuid: user.uuid,
      email: user.email,
    });
    expect(document.note).toContain("intentionally excluded");
  });

  it("does not upload when erasure wins the preparation race", async () => {
    mocks.prepareExport.mockResolvedValue(false);

    await expect(
      runAccountDataExport({ requestUuid: request.uuid }),
    ).resolves.toBeUndefined();

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.completeExport).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});
