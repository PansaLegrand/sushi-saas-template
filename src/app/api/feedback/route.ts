import { NextRequest } from "next/server";
import { insertFeedback } from "@/models/feedback";
import { getUserUuid } from "@/services/user";
import { respData, respErr, respNoAuth } from "@/lib/resp";

export async function POST(req: NextRequest) {
  try {
    const userUuid = await getUserUuid(req as any);
    if (!userUuid) return respNoAuth();

    const body = await req.json().catch(() => ({} as any));
    const rawContent = body?.content;
    const rawRating = body?.rating;

    if (!rawContent || typeof rawContent !== "string") {
      return respErr("content is required");
    }

    const content = rawContent.trim();
    if (content.length < 3) {
      return respErr("content too short");
    }

    let rating: number | undefined = undefined;
    if (rawRating !== undefined && rawRating !== null && rawRating !== "") {
      const r = Number(rawRating);
      if (!Number.isNaN(r) && r >= 1 && r <= 5) {
        rating = r;
      }
    }

    const feedback = await insertFeedback({
      user_uuid: userUuid,
      content,
      rating,
      status: "new",
      created_at: new Date() as any,
    });

    return respData({ id: feedback?.id });
  } catch (e) {
    console.error("feedback submit failed", e);
    return respErr("feedback submit failed", { status: 500 });
  }
}

