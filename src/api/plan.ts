import { api } from "@/lib/api/client";
import type { PlanSnapshot } from "@/types/plan";

/** The signed-in user's plan, features, and limits. */
export function getPlan(signal?: AbortSignal) {
  return api.get<PlanSnapshot>("/api/account/plan", { signal });
}
