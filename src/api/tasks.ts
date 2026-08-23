import { api } from "@/lib/api/client";
import type {
  CreateImageGenerationResponse,
  TaskRecord,
} from "@/types/task";
import { organizationHeaders } from "./organization-context";

export type { TaskRecord } from "@/types/task";

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

export function newTaskIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createImageGenerationTask(input: {
  prompt: string;
  idempotencyKey: string;
}) {
  return api.post<CreateImageGenerationResponse>(
    "/api/tasks/image-generation",
    {
      headers: organizationHeaders({
        "Idempotency-Key": input.idempotencyKey,
      }),
      body: input,
    },
  );
}
