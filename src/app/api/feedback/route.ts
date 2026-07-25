import { z } from "zod";
import { NextRequest } from "next/server";

import { insertFeedback } from "@/models/feedback";
import { getUserUuid } from "@/services/user";
import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";

const FeedbackSchema = z.object({
  content: z.string().trim().min(3),
  rating: z
    .preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int().min(1).max(5).optional()
    )
    .optional(),
});

export async function POST(req: NextRequest) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "feedback");
  if (limited) return limited;

  try {
    const userUuid = await getUserUuid(req as any);
    if (!userUuid) return respNoAuth();

    const { content, rating } = await parseJsonBody(req, FeedbackSchema);

    const feedback = await insertFeedback({
      user_uuid: userUuid,
      content,
      rating,
      status: "new",
      created_at: new Date() as any,
    });

    return respData({ id: feedback?.id });
  } catch (error) {
    return respError(error, {
      logFields: { event: "feedback.submit_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
