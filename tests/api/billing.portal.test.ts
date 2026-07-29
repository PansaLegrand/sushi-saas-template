/**
 * The billing portal exposes organization-wide invoices, payment methods, and
 * cancellation controls. Its route must authenticate and authorize before any
 * customer lookup, and every successful session must use the validated named
 * Stripe configuration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { OrgContext } from "@/services/authz";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn<typeof import("@/services/authz").getOrgContext>(),
  can: vi.fn<typeof import("@/services/authz").can>(),
  findOrganizationByUuid:
    vi.fn<typeof import("@/models/organization").findOrganizationByUuid>(),
  findUserByUuid: vi.fn<typeof import("@/models/user").findUserByUuid>(),
  getOrCreateCustomerIdForOrg:
    vi.fn<typeof import("@/services/stripe").getOrCreateCustomerIdForOrg>(),
  createSafeBillingPortalSession:
    vi.fn<
      typeof import("@/services/stripe/portal").createSafeBillingPortalSession
    >(),
  stripe: {},
}));

vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
  can: mocks.can,
}));
vi.mock("@/models/organization", () => ({
  findOrganizationByUuid: mocks.findOrganizationByUuid,
}));
vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
}));
vi.mock("@/services/stripe", () => ({
  getOrCreateCustomerIdForOrg: mocks.getOrCreateCustomerIdForOrg,
}));
vi.mock("@/services/stripe/portal", () => ({
  createSafeBillingPortalSession: mocks.createSafeBillingPortalSession,
}));
vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({ stripe: () => mocks.stripe }),
}));

import {
  GET as getBillingPortal,
  POST as postBillingPortal,
} from "@/app/api/billing/portal/route";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  closeRateLimitStoreForTests,
  resetRateLimitForTests,
} from "@/lib/rate-limit";
import { get, postJson } from "../helpers/request";

const context = {
  userUuid: "user_1",
  userId: "auth_1",
  orgUuid: "org_1",
  orgId: "org_db_1",
  orgSlug: "workspace",
  orgName: "Workspace",
  orgIsPersonal: false,
  role: "owner" as const,
} as unknown as OrgContext;

describe("billing portal route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "http://test.local");
    vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_safe1");
    resetEnvCacheForTests();
    resetRateLimitForTests();
    await closeRateLimitStoreForTests();

    mocks.getOrgContext.mockResolvedValue(context);
    mocks.can.mockReturnValue(true);
    mocks.findUserByUuid.mockResolvedValue({
      uuid: "user_1",
      email: "owner@example.test",
      locale: "en",
    } as never);
    mocks.findOrganizationByUuid.mockResolvedValue({
      uuid: "org_1",
      name: "Workspace",
      stripe_customer_id: "cus_1",
    } as never);
    mocks.getOrCreateCustomerIdForOrg.mockResolvedValue("cus_1");
    mocks.createSafeBillingPortalSession.mockResolvedValue({
      id: "bps_1",
      url: "https://billing.stripe.test/session",
    } as never);
  });

  it("rejects a signed-out caller before reading billing data", async () => {
    mocks.getOrgContext.mockResolvedValue(null);

    const response = await getBillingPortal(
      get("/api/billing/portal") as NextRequest,
    );

    expect(response.status).toBe(401);
    expect(mocks.findUserByUuid).not.toHaveBeenCalled();
    expect(mocks.findOrganizationByUuid).not.toHaveBeenCalled();
    expect(mocks.getOrCreateCustomerIdForOrg).not.toHaveBeenCalled();
  });

  it("rejects a non-owner before creating a Stripe session", async () => {
    mocks.can.mockReturnValue(false);

    const response = await getBillingPortal(
      get("/api/billing/portal") as NextRequest,
    );

    expect(response.status).toBe(403);
    expect(mocks.findUserByUuid).not.toHaveBeenCalled();
    expect(mocks.createSafeBillingPortalSession).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before authentication", async () => {
    const request = postJson(
      "/api/billing/portal",
      {},
      { headers: { origin: "https://attacker.test" } },
    );

    const response = await postBillingPortal(request as NextRequest);

    expect(response.status).toBe(403);
    expect(mocks.getOrgContext).not.toHaveBeenCalled();
  });

  it("creates the portal with the locked configuration for an owner", async () => {
    const request = postJson(
      "/api/billing/portal",
      { locale: "en" },
      { headers: { origin: "http://test.local" } },
    );

    const response = await postBillingPortal(request as NextRequest);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.url).toBe("https://billing.stripe.test/session");
    expect(mocks.createSafeBillingPortalSession).toHaveBeenCalledWith(
      mocks.stripe,
      {
        customerId: "cus_1",
        returnUrl: "http://test.local/account/billing?org=workspace",
        configurationId: "bpc_safe1",
      },
    );
  });
});
