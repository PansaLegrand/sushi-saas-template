export type TaskStatus =
  | "pending_payment"
  | "queued"
  | "running"
  | "refunding"
  | "succeeded"
  | "failed";

export interface TaskRecord {
  uuid: string;
  userUuid: string;
  type: string;
  status: TaskStatus;
  creditsUsed: number;
  creditsTransNo?: string | null;
  idempotencyKey?: string | null;
  jobUuid?: string | null;
  userInput?: string | null;
  outputUrl?: string | null;
  outputFileUuid?: string | null;
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
  idempotencyKey?: string;
}

export interface CreateTextToVideoResponse {
  task: TaskRecord;
}

export interface CreateImageGenerationRequest {
  prompt: string;
  idempotencyKey: string;
}

export interface CreateImageGenerationResponse {
  task: TaskRecord;
  replayed: boolean;
}
