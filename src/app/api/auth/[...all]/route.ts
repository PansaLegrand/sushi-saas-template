import { auth } from "@/lib/auth";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(req: Request) {
  const limited = rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  return handlers.POST(req);
}
