import { auth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/origin";
import {
  getAuthRateLimitBucket,
  getAuthIdentityRateLimitKey,
  rateLimitOrThrow,
} from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(req: Request) {
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
