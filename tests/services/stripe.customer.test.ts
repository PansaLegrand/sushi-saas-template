/**
 * Stripe Customer ownership and concurrent creation safety.
 *
 * Checkout intent idempotency prevents duplicate subscriptions, but two
 * simultaneous first checkouts can still race while creating the
 * organization-owned Customer. This test pins the stable Stripe idempotency
 * key that closes that adjacent gap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setOrganizationStripeCustomerId:
    vi.fn<
      typeof import("@/models/organization").setOrganizationStripeCustomerId
    >(),
  customerList: vi.fn(),
  customerRetrieve: vi.fn(),
  customerCreate: vi.fn(),
}));

vi.mock("@/models/organization", () => ({
  setOrganizationStripeCustomerId: mocks.setOrganizationStripeCustomerId,
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({
      customers: {
        list: mocks.customerList,
        retrieve: mocks.customerRetrieve,
        create: mocks.customerCreate,
      },
    }),
  }),
}));

import { getOrCreateCustomerIdForOrg } from "@/services/stripe/customer";

const ORG = {
  orgUuid: "org-1",
  orgName: "Example Org",
  email: "owner@example.test",
  stripe_customer_id: null,
};

describe("getOrCreateCustomerIdForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setOrganizationStripeCustomerId.mockResolvedValue();
    mocks.customerRetrieve.mockResolvedValue({
      id: "cus_existing",
      deleted: false,
    });
    mocks.customerList.mockResolvedValue({ data: [] });
    mocks.customerCreate.mockResolvedValue({ id: "cus_new" });
  });

  it("verifies and returns the stored organization customer", async () => {
    await expect(
      getOrCreateCustomerIdForOrg({
        ...ORG,
        stripe_customer_id: "cus_existing",
      }),
    ).resolves.toBe("cus_existing");

    expect(mocks.customerRetrieve).toHaveBeenCalledWith("cus_existing");
    expect(mocks.customerList).not.toHaveBeenCalled();
    expect(mocks.customerCreate).not.toHaveBeenCalled();
  });

  it("replaces a deleted stored customer with a stable recovery key", async () => {
    mocks.customerRetrieve.mockResolvedValue({
      id: "cus_deleted",
      deleted: true,
    });

    await expect(
      getOrCreateCustomerIdForOrg({
        ...ORG,
        stripe_customer_id: "cus_deleted",
      }),
    ).resolves.toBe("cus_new");

    expect(mocks.customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { org_uuid: "org-1" } }),
      {
        idempotencyKey: "org-customer:org-1:replace:cus_deleted",
      },
    );
  });

  it("replaces a missing stored customer but propagates other Stripe outages", async () => {
    mocks.customerRetrieve.mockRejectedValueOnce({
      statusCode: 404,
      code: "resource_missing",
    });

    await expect(
      getOrCreateCustomerIdForOrg({
        ...ORG,
        stripe_customer_id: "cus_missing",
      }),
    ).resolves.toBe("cus_new");
    expect(mocks.customerCreate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: "org-customer:org-1:replace:cus_missing",
      }),
    );

    mocks.customerRetrieve.mockRejectedValueOnce(new Error("Stripe outage"));
    await expect(
      getOrCreateCustomerIdForOrg({
        ...ORG,
        stripe_customer_id: "cus_unreachable",
      }),
    ).rejects.toThrow("Stripe outage");
  });

  it("creates the organization customer with a stable idempotency key", async () => {
    await expect(getOrCreateCustomerIdForOrg(ORG)).resolves.toBe("cus_new");

    expect(mocks.customerCreate).toHaveBeenCalledWith(
      {
        email: ORG.email,
        name: ORG.orgName,
        metadata: { org_uuid: ORG.orgUuid },
      },
      { idempotencyKey: "org-customer:org-1" },
    );
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith(
      "org-1",
      "cus_new",
    );
  });

  it("adopts only a customer carrying the same organization metadata", async () => {
    mocks.customerList.mockResolvedValue({
      data: [
        { id: "cus_other", metadata: { org_uuid: "org-2" } },
        { id: "cus_match", metadata: { org_uuid: "org-1" } },
      ],
    });

    await expect(getOrCreateCustomerIdForOrg(ORG)).resolves.toBe("cus_match");

    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith(
      "org-1",
      "cus_match",
    );
  });

  it("keeps the Stripe result recoverable when the local link write fails", async () => {
    mocks.setOrganizationStripeCustomerId.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(getOrCreateCustomerIdForOrg(ORG)).resolves.toBe("cus_new");
    expect(mocks.customerCreate).toHaveBeenCalledTimes(1);
  });
});
