/**
 * `ActionRequiredError.describe()` writes the one line an operator reads.
 *
 * It lands in `stripe_webhook_events.last_error`, which is where someone looks
 * when a sweep tells them an event needs attention. A line that says
 * `renewal_user_unresolved (stripe_customer_email=undefined)` wastes the only
 * chance to be useful, so the formatting is worth pinning.
 */
import { describe, expect, it } from "vitest";

import {
  ActionRequiredError,
  isActionRequired,
} from "@/services/stripe/action-required";

describe("ActionRequiredError", () => {
  it("keeps the reason machine-groupable and the detail separate", () => {
    // A sweep counts by `reason`, so it must not vary with the specifics.
    const error = new ActionRequiredError("unmapped_price", {
      stripe_price_id: "price_1",
    });

    expect(error.reason).toBe("unmapped_price");
    expect(error.detail).toEqual({ stripe_price_id: "price_1" });
  });

  it("renders the identifiers needed to act", () => {
    const error = new ActionRequiredError("unmapped_price", {
      stripe_price_id: "price_1",
      stripe_invoice_id: "in_1",
    });

    expect(error.describe()).toBe(
      "unmapped_price (stripe_price_id=price_1 stripe_invoice_id=in_1)"
    );
  });

  it("drops absent fields rather than printing undefined", () => {
    // `renewal_user_unresolved` passes an email that is absent by definition —
    // not resolving it is why the error was raised.
    const error = new ActionRequiredError("renewal_user_unresolved", {
      stripe_invoice_id: "in_2",
      stripe_customer_email: undefined,
      user_id: null,
      note: "",
    });

    expect(error.describe()).toBe("renewal_user_unresolved (stripe_invoice_id=in_2)");
  });

  it("renders the bare reason when there is no detail", () => {
    expect(new ActionRequiredError("unmapped_price").describe()).toBe(
      "unmapped_price"
    );
  });

  it("is recognizable through a catch, where it is actually used", () => {
    // The route branches on this to choose 200 over 500. An `instanceof` that
    // failed would silently turn every parked event back into a retry storm.
    try {
      throw new ActionRequiredError("unmapped_price");
    } catch (error) {
      expect(isActionRequired(error)).toBe(true);
    }

    expect(isActionRequired(new Error("boom"))).toBe(false);
    expect(isActionRequired("unmapped_price")).toBe(false);
  });
});
