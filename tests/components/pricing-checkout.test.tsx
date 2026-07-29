/**
 * Pricing checkout click guard.
 *
 * React state does not update the DOM synchronously, so two click events can
 * enter one handler before `disabled` appears. This test fires both in one
 * batch and proves the synchronous ref permits only one HTTP request carrying
 * one browser-generated purchase intent.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Pricing from "@/components/blocks/pricing";
import type { PricingItem } from "@/types/blocks/pricing";

const mocks = vi.hoisted(() => ({
  pathname: "/pricing",
  push: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

const BASE_ITEM: PricingItem = {
  title: "Max",
  interval: "month",
  product_id: "max-monthly",
  product_name: "Max Monthly",
  amount: 7_900,
  currency: "usd",
  button: { title: "Subscribe" },
};

function renderPricing({
  items = [BASE_ITEM],
  locale = "en",
}: {
  items?: PricingItem[];
  locale?: string;
} = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <Pricing
        pricing={{
          name: "pricing",
          title: "Plans",
          items,
        }}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.pathname = "/pricing";
  mocks.push.mockReset();
  mocks.search = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pricing checkout", () => {
  it("sends only one request for two synchronous clicks", () => {
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => void 0),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPricing();

    const button = screen.getByRole("button", { name: "Subscribe" });
    act(() => {
      button.click();
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
    );
  });

  it("uses a statically discoverable grid class for the visible plans", () => {
    const { container } = renderPricing({
      items: [
        BASE_ITEM,
        { ...BASE_ITEM, title: "Pro", product_id: "pro-monthly" },
        { ...BASE_ITEM, title: "Team", product_id: "team-monthly" },
      ],
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Plans" }),
    ).toBeVisible();
    expect(container.querySelector("[data-plan-grid]")).toHaveClass(
      "md:grid-cols-3",
    );
  });

  it("sends unauthenticated customers to localized login and returns them to pricing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: -1,
          error_code: "AUTH_REQUIRED",
          message: "Authentication required",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    mocks.pathname = "/es/pricing";
    mocks.search = "org=team-workspace";
    renderPricing({ locale: "es" });
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/es/login?callbackUrl=%2Fes%2Fpricing%3Forg%3Dteam-workspace",
      ),
    );
  });

  it("exposes CNY checkout as a keyboard-operable payment button", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => void 0),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPricing({
      items: [{ ...BASE_ITEM, cn_amount: 54_900 }],
    });

    const cnyButton = screen.getByRole("button", {
      name: "Pay for Max in CNY",
    });
    cnyButton.focus();
    await user.keyboard("{Enter}");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      currency: "cny",
      product_id: "max-monthly",
    });
  });
});
