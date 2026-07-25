/**
 * The no-leak guarantee, from the browser's side.
 *
 * The server promises never to return a raw exception message; this tier proves
 * the client never *renders* one either — including for the shapes it cannot
 * control, like an HTML error page from a proxy or a body that is not JSON.
 *
 * Lives in the component tier rather than `tests/unit/` because the whole point
 * is what a user would end up seeing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api/client";
import {
  ClientApiError,
  isClientApiError,
  resolveErrorMessage,
} from "@/lib/errors/client";

/**
 * Resolve with whatever a call rejected with.
 *
 * `.catch(e => e)` widens the result to `unknown`, which makes every assertion
 * below need a cast. The client's contract is that it only ever rejects with a
 * ClientApiError, so assert that once, here.
 */
async function rejection(promise: Promise<unknown>): Promise<ClientApiError> {
  return promise.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (error: unknown) => error as ClientApiError
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("unwraps the data envelope rather than returning it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: "ok", data: { slots: ["09:00"] } }))
    );

    // The bug this replaced: reading `slots` off the envelope, where it is
    // undefined, so the caller silently saw an empty list.
    await expect(api.post<{ slots: string[] }>("/api/reservations/availability")).resolves.toEqual({
      slots: ["09:00"],
    });
  });

  it("throws a coded error for a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error_code: "CREDITS_INSUFFICIENT", message: "nope" }, 400)
      )
    );

    const error = await rejection(api.get("/api/account/credits"));

    expect(isClientApiError(error)).toBe(true);
    expect(error.code).toBe("CREDITS_INSUFFICIENT");
    expect(error.status).toBe(400);
  });

  it("treats a 200 carrying a non-zero code as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: -2, message: "no auth" }))
    );

    const error = await rejection(api.get("/api/account/credits"));

    expect(isClientApiError(error)).toBe(true);
    expect(error.code).toBe("AUTH_REQUIRED");
  });

  it("survives a response that is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        })
      )
    );

    const error = await rejection(api.get("/api/health"));

    expect(isClientApiError(error)).toBe(true);
    expect(error.code).toBe("SERVER_ERROR");
    // Never the proxy's HTML.
    expect(resolveErrorMessage(error)).not.toContain("Bad Gateway");
  });

  it("reports an unreachable server as a network failure, not a server bug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await rejection(api.get("/api/health"));

    expect(error.code).toBe("NETWORK_UNAVAILABLE");
    expect(resolveErrorMessage(error)).toMatch(/connection/i);
  });

  it("serializes a JSON body and sets the content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: "ok", data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/api/feedback", { body: { content: "hi", rating: 5 } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ content: "hi", rating: 5 }));
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("appends query parameters and drops undefined ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: "ok", data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/storage/files", { query: { download: 1, cursor: undefined } });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/storage/files?download=1");
  });

  it("localizes the message rather than echoing the server's English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error_code: "CREDITS_INSUFFICIENT", message: "insufficient credits" }, 400)
      )
    );

    const error = await rejection(api.get("/api/account/credits"));

    expect(resolveErrorMessage(error, "fr")).not.toBe("insufficient credits");
    expect(resolveErrorMessage(error, "fr")).toMatch(/crédits/i);
  });
});
