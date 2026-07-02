import { respForbidden } from "@/lib/resp";

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function requireSameOrigin(req: Request): Response | null {
  const expected = normalizeOrigin(req.url);
  const origin = normalizeOrigin(req.headers.get("origin"));
  const referer = normalizeOrigin(req.headers.get("referer"));

  if (origin && origin !== expected) {
    return respForbidden("invalid origin");
  }

  if (!origin && referer && referer !== expected) {
    return respForbidden("invalid referer");
  }

  return null;
}
