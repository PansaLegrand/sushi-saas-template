import { api } from "@/lib/api/client";
import type { CreditQueryRequest } from "@/types/api";
import type { CreditSummary } from "@/types/credit";

export function getCreditSummary(input: CreditQueryRequest = {}) {
  return api.post<CreditSummary>("/api/account/credits", { body: input });
}

export function consumeCredits(credits: number) {
  return api.post<{ balance: number }>("/api/account/credits/consume", {
    body: { credits },
  });
}
