/**
 * Request builders shared by route tests.
 *
 * Route handlers take a real `Request`, so tests construct one rather than
 * mocking it. Keeping the builders here stops each test file from inventing a
 * slightly different one — the header casing and body encoding matter, because
 * `req.json()` and the origin guards read them.
 */

const DEFAULT_ORIGIN = "http://test.local";

export function url(path: string): string {
  return path.startsWith("http") ? path : `${DEFAULT_ORIGIN}${path}`;
}

/** JSON POST, the shape every mutating route in this app expects. */
export function postJson(
  path: string,
  body: unknown = {},
  init: RequestInit = {}
): Request {
  return new Request(url(path), {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

export function get(path: string, init: RequestInit = {}): Request {
  return new Request(url(path), { method: "GET", ...init });
}

/** Attaches a session cookie so a test can exercise the authenticated path. */
export function withSession(
  request: Request,
  token = "test-session-token"
): Request {
  const headers = new Headers(request.headers);
  headers.set("cookie", `better-auth.session_token=${token}`);
  return new Request(request, { headers });
}
