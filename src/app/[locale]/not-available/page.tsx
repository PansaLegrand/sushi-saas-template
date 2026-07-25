import { notFound } from "next/navigation";

/**
 * The rewrite target for a route that `site` mode does not serve.
 *
 * It exists so the middleware has something real to point at. Rewriting to a
 * path that matches no route looked simpler but resolved inconsistently — the
 * request fell through to the landing page with a 200 — whereas `notFound()`
 * here is unambiguous: status 404, rendered through `[locale]/not-found.tsx`,
 * localized and styled like the rest of the site.
 *
 * Reachable directly in `app` mode too, where it does exactly the same thing.
 */
export default function NotAvailable() {
  notFound();
}
