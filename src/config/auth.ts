export const AUTH_ROUTES = {
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  defaultCallback: "/",
} as const;

export type AuthRouteKey = keyof typeof AUTH_ROUTES;

export function withLocale(locale: string | undefined, path: string) {
  const prefix = locale ? `/${locale}` : "";
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const full = `${prefix}${suffix}`;
  return full || "/";
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
