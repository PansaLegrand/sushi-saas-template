export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface TaskRecord {
  uuid: string;
  userUuid: string;
  type: string;
  status: TaskStatus;
  creditsUsed: number;
  creditsTransNo?: string | null;
  userInput?: string | null;
  outputUrl?: string | null;
  outputJson?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTextToVideoRequest {
  prompt: string;
  seconds?: number;
  aspectRatio?: string;
}

export interface CreateTextToVideoResponse {
  task: TaskRecord;
}
