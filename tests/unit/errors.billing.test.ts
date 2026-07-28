/**
 * The classifier that decides whether a failure is an upsell.
 *
 * Two properties matter more than the happy path. First, it must claim only the
 * three billing codes — a hook that opens a pricing dialog on a network blip is
 * worse than no hook. Second, it must survive a `details` payload that is not
 * what this version of the client expects: routes get migrated at different
 * times, proxies rewrite bodies, and a dialog that renders "You need NaN more
 * credits" is a bug report about billing.
 */
import { describe, expect, it } from "vitest";

import { describeBillingBlock, isBillingBlock } from "@/lib/errors/billing";
import { ClientApiError } from "@/lib/errors/client";

function apiError(code: string, details?: unknown) {
  return new ClientApiError({
    code: code as never,
    status: 400,
    message: "server text nobody should read",
    details,
  });
}

describe("describeBillingBlock", () => {
  it("classifies the three codes that money fixes", () => {
    expect(describeBillingBlock(apiError("CREDITS_INSUFFICIENT"))?.kind).toBe("credits");
    expect(describeBillingBlock(apiError("PLAN_UPGRADE_REQUIRED"))?.kind).toBe("feature");
    expect(describeBillingBlock(apiError("PLAN_LIMIT_EXCEEDED"))?.kind).toBe("limit");
  });

  it("claims nothing else", () => {
    for (const code of [
      "AUTH_REQUIRED",
      "SERVER_ERROR",
      "REQUEST_RATE_LIMITED",
      "TASK_CREATE_FAILED",
      "CREDITS_INVALID_AMOUNT",
    ]) {
      expect(describeBillingBlock(apiError(code))).toBeNull();
    }
  });

  it("ignores failures that never reached the server", () => {
    // A thrown TypeError from a click handler, a rejected fetch, a string.
    expect(describeBillingBlock(new Error("insufficient credits"))).toBeNull();
    expect(describeBillingBlock("CREDITS_INSUFFICIENT")).toBeNull();
    expect(describeBillingBlock(null)).toBeNull();
    expect(describeBillingBlock(undefined)).toBeNull();
  });

  it("derives the shortfall from what the server sent", () => {
    const block = describeBillingBlock(
      apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6 })
    );

    expect(block).toMatchObject({ required: 10, available: 6, shortfall: 4 });
  });

  it("prefers a shortfall the server computed itself", () => {
    const block = describeBillingBlock(
      apiError("CREDITS_INSUFFICIENT", { required: 10, available: 6, shortfall: 3 })
    );

    expect(block?.shortfall).toBe(3);
  });

  it("never reports a negative shortfall", () => {
    // Possible under a concurrent top-up: the balance read after the refusal
    // can exceed the cost that was refused a moment earlier.
    const block = describeBillingBlock(
      apiError("CREDITS_INSUFFICIENT", { required: 5, available: 9 })
    );

    expect(block?.shortfall).toBe(0);
  });

  it("drops counts that are not usable numbers", () => {
    const block = describeBillingBlock(
      apiError("CREDITS_INSUFFICIENT", {
        required: "10",
        available: Number.NaN,
        shortfall: -4,
      })
    );

    expect(block).toEqual({ kind: "credits", code: "CREDITS_INSUFFICIENT" });
    expect(block).not.toHaveProperty("shortfall");
  });

  it("survives details that are missing, null, or the wrong shape entirely", () => {
    for (const details of [undefined, null, "nope", 42, []]) {
      const block = describeBillingBlock(apiError("CREDITS_INSUFFICIENT", details));
      expect(block?.kind).toBe("credits");
      expect(block?.shortfall).toBeUndefined();
    }
  });

  it("passes the required tier through without interpreting it", () => {
    const block = describeBillingBlock(
      apiError("PLAN_UPGRADE_REQUIRED", {
        feature: "tasks.text_to_video",
        tier: "free",
        requiredTier: "plus",
      })
    );

    expect(block?.requiredTier).toBe("plus");
  });

  it("tolerates a tier the client has never heard of", () => {
    // The point of not owning the catalog: a server that grows a tier does not
    // need a client deploy.
    expect(
      describeBillingBlock(apiError("PLAN_UPGRADE_REQUIRED", { requiredTier: "team" }))
        ?.requiredTier
    ).toBe("team");
  });

  it("drops a tier that is null, empty, or absurdly long", () => {
    // `requiredTier` is null when no tier includes the feature at all.
    expect(
      describeBillingBlock(apiError("PLAN_UPGRADE_REQUIRED", { requiredTier: null }))
        ?.requiredTier
    ).toBeUndefined();

    expect(
      describeBillingBlock(apiError("PLAN_UPGRADE_REQUIRED", { requiredTier: "   " }))
        ?.requiredTier
    ).toBeUndefined();

    expect(
      describeBillingBlock(
        apiError("PLAN_UPGRADE_REQUIRED", { requiredTier: "x".repeat(200) })
      )?.requiredTier
    ).toBeUndefined();
  });

  it("never carries the server's message forward", () => {
    const block = describeBillingBlock(
      apiError("CREDITS_INSUFFICIENT", { required: 10 })
    );

    expect(JSON.stringify(block)).not.toContain("nobody should read");
  });
});

describe("isBillingBlock", () => {
  it("agrees with describeBillingBlock", () => {
    expect(isBillingBlock(apiError("CREDITS_INSUFFICIENT"))).toBe(true);
    expect(isBillingBlock(apiError("SERVER_ERROR"))).toBe(false);
  });
});
