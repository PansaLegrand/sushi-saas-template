/**
 * Admin credit grants move money-like value. React state cannot close the
 * same-render double-click window, and an uncertain response must be retried
 * with the original idempotency key rather than a fresh grant intent.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import GrantCreditsPanel from "@admin/components/grant-credits";

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: "ok", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function grantCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url, init]) => {
    return (
      String(url).endsWith("/api/admin/credits/grant") &&
      init?.method === "POST"
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GrantCreditsPanel", () => {
  it("sends one grant for two synchronous clicks", async () => {
    let resolveGrant!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).endsWith("/api/admin/credits/grant")) {
        return new Promise<Response>((resolve) => {
          resolveGrant = resolve;
        });
      }
      return Promise.resolve(
        apiResponse({
          balance: 100,
          granted: 100,
          consumed: 0,
          expired: 0,
          expiringSoon: [],
          ledger: [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GrantCreditsPanel canWrite />);

    await user.type(screen.getByLabelText("User UUID"), "user-1");
    const button = screen.getByRole("button", { name: "Grant credits" });
    act(() => {
      button.click();
      button.click();
    });

    expect(grantCalls(fetchMock)).toHaveLength(1);

    resolveGrant(apiResponse({ replayed: false }));
    await waitFor(() =>
      expect(screen.getByText("Balance")).toBeInTheDocument(),
    );
  });

  it("retains the idempotency key after an uncertain response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(apiResponse({ replayed: true }))
      .mockResolvedValueOnce(
        apiResponse({
          balance: 100,
          granted: 100,
          consumed: 0,
          expired: 0,
          expiringSoon: [],
          ledger: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GrantCreditsPanel canWrite />);

    await user.type(screen.getByLabelText("User UUID"), "user-1");
    await user.click(screen.getByRole("button", { name: "Grant credits" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Grant credits" }));

    const calls = grantCalls(fetchMock);
    expect(calls).toHaveLength(2);
    const firstBody = JSON.parse(String(calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(calls[1]?.[1]?.body));
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });
});
