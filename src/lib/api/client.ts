/**
 * Browser-side transport for this app's own API.
 *
 * Every call site used to repeat the same twelve lines: fetch, `.json()` in a
 * try/catch, check `res.ok`, check `payload.code !== 0`, then `throw new
 * Error(payload.message)`. That last step is the expensive one — it puts raw
 * server text on screen, untranslated, and it is exactly what the error catalog
 * exists to prevent. Errors from here are always `ClientApiError`, carrying a
 * catalogued `code` that `resolveErrorMessage` turns into localized copy.
 *
 * This module knows nothing about credits, files, or reservations — that is the
 * `lib/` rule, and it is why the domain wrappers live in `src/api/`.
 */

import { ClientApiError, parseApiResponse, readApiError } from "@/lib/errors/client";

export type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  /** Serialized as JSON. Pass a FormData/Blob through `raw` instead. */
  body?: unknown;
  /** Bypasses JSON serialization for uploads and other non-JSON payloads. */
  raw?: BodyInit;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
};

function withQuery(
  path: string,
  query: ApiRequestOptions["query"]
): string {
  if (!query) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }

  const qs = params.toString();
  if (!qs) return path;
  return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
}

async function request<T>(
  method: string,
  path: string,
  { body, raw, query, headers, ...init }: ApiRequestOptions = {}
): Promise<T> {
  const hasJsonBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(withQuery(path, query), {
      ...init,
      method,
      headers: {
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: raw ?? (hasJsonBody ? JSON.stringify(body) : undefined),
    });
  } catch (cause) {
    // fetch only rejects when the request never completed: offline, DNS
    // failure, CORS, or an aborted navigation. There is no status to infer a
    // code from, so name it explicitly rather than letting it fall through to
    // SERVER_ERROR, which would tell the user to try again on our side.
    throw new ClientApiError({
      code: "NETWORK_UNAVAILABLE",
      status: 0,
      message: cause instanceof Error ? cause.message : "Network request failed",
    });
  }

  return parseApiResponse<T>(response);
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>("GET", path, options),
  post: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>("POST", path, options),
  put: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>("PUT", path, options),
  patch: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>("PATCH", path, options),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>("DELETE", path, options),
};

export { readApiError };
