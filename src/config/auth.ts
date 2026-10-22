import { localePath } from "@/i18n/locale";

export const AUTH_ROUTES = {
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  defaultCallback: "/account/billing",
  signedOutCallback: "/",
} as const;

export type AuthRouteKey = keyof typeof AUTH_ROUTES;

/** Session inventory/revocation use the app's redacted, fresh-session boundary. */
export function isManagedSessionEndpoint(pathname: string): boolean {
  let path = pathname;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch { return true; }
  if (/[\u0000-\u001f\u007f]/.test(path)) return true;
  const endpoint = path.replace(/\/+$/, "").split("/").at(-1)?.toLowerCase();
  return ["list-sessions", "revoke-session", "revoke-sessions", "revoke-other-sessions"].includes(endpoint ?? "");
}

export function withLocale(locale: string | undefined, path: string) {
  return localePath(locale, path);
}

export function absoluteWithLocale(
  locale: string | undefined,
  path: string,
  base: string | undefined = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"
) {
  const rel = withLocale(locale, path);
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel; // fallback to relative if URL construction fails
  }
}
