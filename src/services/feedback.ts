import { insertFeedback } from "@/models/feedback";

/** Persist one authenticated user's feedback with server-owned state. */
export async function submitFeedback(input: {
  userUuid: string;
  content: string;
  rating?: number;
}) {
  return insertFeedback({
    user_uuid: input.userUuid,
    content: input.content,
    rating: input.rating,
    status: "new",
    created_at: new Date(),
  });
}
