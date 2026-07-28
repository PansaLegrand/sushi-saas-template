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
  customerCreate: vi.fn(),
}));

vi.mock("@/models/organization", () => ({
  setOrganizationStripeCustomerId:
    mocks.setOrganizationStripeCustomerId,
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({
      customers: {
        list: mocks.customerList,
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
    mocks.customerList.mockResolvedValue({ data: [] });
    mocks.customerCreate.mockResolvedValue({ id: "cus_new" });
  });

  it("returns the stored organization customer without calling Stripe", async () => {
    await expect(
      getOrCreateCustomerIdForOrg({
        ...ORG,
        stripe_customer_id: "cus_existing",
      })
    ).resolves.toBe("cus_existing");

    expect(mocks.customerList).not.toHaveBeenCalled();
    expect(mocks.customerCreate).not.toHaveBeenCalled();
  });

  it("creates the organization customer with a stable idempotency key", async () => {
    await expect(getOrCreateCustomerIdForOrg(ORG)).resolves.toBe("cus_new");

    expect(mocks.customerCreate).toHaveBeenCalledWith(
      {
        email: ORG.email,
        name: ORG.orgName,
        metadata: { org_uuid: ORG.orgUuid },
      },
      { idempotencyKey: "org-customer:org-1" }
    );
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith(
      "org-1",
      "cus_new"
    );
  });

  it("adopts only a customer carrying the same organization metadata", async () => {
    mocks.customerList.mockResolvedValue({
      data: [
        { id: "cus_other", metadata: { org_uuid: "org-2" } },
        { id: "cus_match", metadata: { org_uuid: "org-1" } },
      ],
    });

    await expect(getOrCreateCustomerIdForOrg(ORG)).resolves.toBe(
      "cus_match"
    );

    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.setOrganizationStripeCustomerId).toHaveBeenCalledWith(
      "org-1",
      "cus_match"
    );
  });
});
