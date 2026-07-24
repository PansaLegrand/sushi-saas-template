import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin-wide response hardening.
 *
 * The RBAC gate stays in `(admin)/layout.tsx` and in each route handler — this
 * only sets headers, so it never becomes the thing standing between an
 * unauthenticated request and admin data.
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
