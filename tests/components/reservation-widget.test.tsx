/**
 * Reservation browser-intent lifecycle.
 *
 * A disabled button alone cannot stop two synchronous click events, and a
 * retry after an uncertain response must repair the first checkout rather than
 * reserve and charge the slot again.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ReservationWidget from "@/components/reservations/reservation-widget";
import messages from "../../messages/en.json";

const SLOT = "2027-01-04T17:00:00.000Z";
const LATER_SLOT = "2027-01-05T18:00:00.000Z";
const SERVICE = {
  id: 1,
  title: "Consultation",
  description: "A consultation",
  duration_min: 30,
  price: 5_000,
  currency: "usd",
  deposit_amount: 500,
  require_deposit: true,
};

function apiResponse(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: 0, message: "ok", data }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function reservationCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith("/api/reservations")
  );
}

function renderWidget(services = [SERVICE]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReservationWidget services={services} locale="en" />
    </NextIntlClientProvider>,
  );
}

async function slotButton() {
  const label = new Date(SLOT).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return screen.findByRole("button", { name: label });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reservation checkout intent", () => {
  it("sends one request and one UUID for two synchronous clicks", async () => {
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/availability")) {
        return Promise.resolve(apiResponse({ slots: [SLOT] }));
      }
      return new Promise<Response>(() => void 0);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();

    const button = await slotButton();
    act(() => {
      button.click();
      button.click();
    });

    const calls = reservationCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]?.[1]?.headers);
    expect(headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
    );
  });

  it("retains the UUID after failure and rotates when terms change", async () => {
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/availability")) {
        return Promise.resolve(apiResponse({ slots: [SLOT] }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: -1,
            error_code: "RESERVATION_CREATE_FAILED",
            message: "The reservation could not be created. Please try again.",
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWidget();

    const button = await slotButton();
    await user.click(button);
    await waitFor(() =>
      expect(
        screen.getByText(
          "The reservation could not be created. Please try again."
        )
      ).toBeVisible()
    );

    await user.click(button);
    let calls = reservationCalls(fetchMock);
    expect(calls).toHaveLength(2);
    const firstIntent = new Headers(calls[0]?.[1]?.headers).get(
      "Idempotency-Key"
    );
    const retryIntent = new Headers(calls[1]?.[1]?.headers).get(
      "Idempotency-Key"
    );
    expect(retryIntent).toBe(firstIntent);

    await user.type(
      screen.getByRole("textbox", { name: "Notes" }),
      "A changed request"
    );
    await user.click(button);

    calls = reservationCalls(fetchMock);
    expect(calls).toHaveLength(3);
    const changedTermsIntent = new Headers(calls[2]?.[1]?.headers).get(
      "Idempotency-Key"
    );
    expect(changedTermsIntent).not.toBe(firstIntent);
  });

  it("does not let a stale availability request overwrite a newer date", async () => {
    let resolveFirst!: (response: Response) => void;
    let availabilityCalls = 0;
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/availability")) {
        availabilityCalls += 1;
        if (availabilityCalls === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(apiResponse({ slots: [LATER_SLOT] }));
      }
      return Promise.resolve(apiResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWidget();

    await waitFor(() => expect(availabilityCalls).toBe(1));
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2027-01-05" },
    });

    const laterLabel = new Date(LATER_SLOT).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(
      await screen.findByRole("button", { name: laterLabel }),
    ).toBeVisible();

    resolveFirst(apiResponse({ slots: [SLOT] }));
    await act(async () => void 0);

    const oldLabel = new Date(SLOT).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(
      screen.queryByRole("button", { name: oldLabel }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a dedicated empty state when no services are configured", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    renderWidget([]);

    expect(
      screen.getByRole("heading", { name: "No services available" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Service")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
