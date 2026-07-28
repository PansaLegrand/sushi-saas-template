/**
 * Pricing checkout click guard.
 *
 * React state does not update the DOM synchronously, so two click events can
 * enter one handler before `disabled` appears. This test fires both in one
 * batch and proves the synchronous ref permits only one HTTP request carrying
 * one browser-generated purchase intent.
 */
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import Pricing from "@/components/blocks/pricing";
import { AppContextProvider } from "@/providers/app-context";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pricing checkout", () => {
  it("sends only one request for two synchronous clicks", () => {
    const fetchMock = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => void 0)
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <AppContextProvider>
          <Pricing
            pricing={{
              name: "pricing",
              title: "Plans",
              items: [
                {
                  title: "Max",
                  interval: "month",
                  product_id: "max-monthly",
                  product_name: "Max Monthly",
                  amount: 7_900,
                  currency: "usd",
                  button: { title: "Subscribe" },
                },
              ],
            }}
          />
        </AppContextProvider>
      </NextIntlClientProvider>
    );

    const button = screen.getByRole("button", { name: "Subscribe" });
    act(() => {
      button.click();
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
    );
  });
});
