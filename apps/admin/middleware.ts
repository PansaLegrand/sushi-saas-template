import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin-wide response hardening.
 *
 * The RBAC gate stays in `(admin)/layout.tsx` and in each route handler — this
 * only sets headers, so it never becomes the thing standing between an
 * unauthenticated request and admin data.
 *
 * Two layers set headers here, deliberately:
 *
 * - `next.config.ts` applies the shared baseline from
 *   `src/config/security-headers.js`, including the full **report-only** CSP.
 * - This file adds what is specific to the admin console, and keeps a narrow
 *   **enforced** CSP. That enforced policy predates the shared one and is known
 *   safe, so it stays on while the broader policy is still collecting reports.
 *
 * The `Referrer-Policy` here is stricter than the shared default on purpose —
 * an admin URL can carry a user id, and `.set()` means this value wins.
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();

  // Admin pages must never be indexed or cached by a shared proxy.
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
