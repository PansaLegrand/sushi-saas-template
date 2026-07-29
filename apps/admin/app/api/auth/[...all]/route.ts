import { auth } from "@/lib/auth";
import { requireSameOrigin } from "@admin/lib/origin";
import {
  getAuthRateLimitBucket,
  rateLimitOrThrow,
} from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, getAuthRateLimitBucket(req));
  if (limited) return limited;

  return handlers.POST(req);
}
