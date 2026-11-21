import { isManagedOrganizationEndpoint, isManagedSessionEndpoint } from "@/config/auth";
import { respCode } from "@/lib/errors/response";
import { auth } from "@/lib/auth";
import { requireSameOrigin } from "@admin/lib/origin";
import {
  getAuthRateLimitBucket,
  getAuthIdentityRateLimitKey,
  rateLimitOrThrow,
} from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export async function GET(req: Request) {
  const pathname = new URL(req.url).pathname;
  if (isManagedSessionEndpoint(pathname) || isManagedOrganizationEndpoint(pathname)) return respCode("AUTH_FORBIDDEN");
  return handlers.GET(req);
}

export async function POST(req: Request) {
  const pathname = new URL(req.url).pathname;
  if (isManagedSessionEndpoint(pathname) || isManagedOrganizationEndpoint(pathname)) return respCode("AUTH_FORBIDDEN");
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const bucket = getAuthRateLimitBucket(req);
  const limited = await rateLimitOrThrow(req, bucket);
  if (limited) return limited;

  const identityKey = await getAuthIdentityRateLimitKey(req);
  if (identityKey) {
    const identityLimited = await rateLimitOrThrow(req, bucket, {
      key: identityKey,
    });
    if (identityLimited) return identityLimited;
  }

  return handlers.POST(req);
}
