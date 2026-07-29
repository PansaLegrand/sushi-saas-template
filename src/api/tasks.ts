import { api } from "@/lib/api/client";
import { organizationHeaders } from "./organization-context";

export interface TaskRecord {
  uuid: string;
  type: string;
  status: string;
  creditsUsed: number;
  createdAt: string;
  outputUrl?: string | null;
}

export function getLatestTask() {
  return api.get<{ task: TaskRecord | null }>("/api/tasks/latest", {
    headers: organizationHeaders(),
  });
}

export function getTask(uuid: string) {
  return api.get<{ task: TaskRecord }>(
    `/api/tasks/${encodeURIComponent(uuid)}`,
    { headers: organizationHeaders() }
  );
}

export function createTextToVideoTask(input: {
  prompt: string;
  seconds: number;
  aspectRatio: string;
}) {
  // One key per attempt: a retry of this request cannot double-charge credits.
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return api.post<{ task: TaskRecord }>("/api/tasks/text-to-video", {
    headers: organizationHeaders({ "Idempotency-Key": idempotencyKey }),
    body: { ...input, idempotencyKey },
  });
}
