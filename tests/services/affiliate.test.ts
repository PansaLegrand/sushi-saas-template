/**
 * Affiliate payout tracking is opt-in and inert in a clean starter checkout.
 *
 * A default-on referral path would create financial liabilities before an
 * adopter has chosen payout rails, currency, refund policy, or tax handling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByUuid: vi.fn<typeof import("@/models/user").findUserByUuid>(),
  findUserByInviteCode:
    vi.fn<typeof import("@/models/user").findUserByInviteCode>(),
  updateUserInvitedBy:
    vi.fn<typeof import("@/models/user").updateUserInvitedBy>(),
  updateUserInviteCode:
    vi.fn<typeof import("@/models/user").updateUserInviteCode>(),
  insertPaidAffiliateOnce:
    vi.fn<typeof import("@/models/affiliate").insertPaidAffiliateOnce>(),
  insertSignupAffiliateOnce:
    vi.fn<typeof import("@/models/affiliate").insertSignupAffiliateOnce>(),
  cancelPendingAffiliateByOrderNo:
    vi.fn<
      typeof import("@/models/affiliate").cancelPendingAffiliateByOrderNo
    >(),
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
  findUserByInviteCode: mocks.findUserByInviteCode,
  updateUserInvitedBy: mocks.updateUserInvitedBy,
  updateUserInviteCode: mocks.updateUserInviteCode,
}));
vi.mock("@/models/affiliate", () => ({
  insertPaidAffiliateOnce: mocks.insertPaidAffiliateOnce,
  insertSignupAffiliateOnce: mocks.insertSignupAffiliateOnce,
  cancelPendingAffiliateByOrderNo: mocks.cancelPendingAffiliateByOrderNo,
}));

import {
  applyAffiliateAttribution,
  cancelAffiliateRewardForOrder,
  ensureAffiliateInviteCode,
  updateAffiliateForOrder,
} from "@/services/affiliate";

describe("default affiliate safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates no attribution, reward, invite code, or refund mutation by default", async () => {
    await applyAffiliateAttribution({
      userUuid: "user_1",
      referrerUuid: "user_2",
    });
    await updateAffiliateForOrder({
      order_no: "order_1",
      user_uuid: "user_1",
      amount: 7_500,
    });
    await ensureAffiliateInviteCode({ userUuid: "user_1" });
    await cancelAffiliateRewardForOrder("order_1");

    expect(mocks.findUserByUuid).not.toHaveBeenCalled();
    expect(mocks.findUserByInviteCode).not.toHaveBeenCalled();
    expect(mocks.updateUserInvitedBy).not.toHaveBeenCalled();
    expect(mocks.updateUserInviteCode).not.toHaveBeenCalled();
    expect(mocks.insertSignupAffiliateOnce).not.toHaveBeenCalled();
    expect(mocks.insertPaidAffiliateOnce).not.toHaveBeenCalled();
    expect(mocks.cancelPendingAffiliateByOrderNo).not.toHaveBeenCalled();
  });
});
