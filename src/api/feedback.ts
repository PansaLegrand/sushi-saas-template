import { api } from "@/lib/api/client";

export function submitFeedback(input: { content: string; rating?: number }) {
  return api.post<unknown>("/api/feedback", { body: input });
}
