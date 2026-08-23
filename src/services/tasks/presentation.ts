import { findFileByUuid } from "@/models/file";
import { findTaskByUuid, type TaskRow } from "@/models/task";
import { getStorageAdapter } from "@/services/storage";
import type { TaskRecord, TaskStatus } from "@/types/task";

/** Convert a tenant-scoped task row into the stable public contract. */
export async function toTaskRecord(task: TaskRow): Promise<TaskRecord> {
  let outputUrl = task.output_url;

  if (task.output_file_uuid) {
    const file = await findFileByUuid(task.output_file_uuid, task.org_uuid);
    if (file?.status === "active") {
      const signed = await getStorageAdapter().getPresignedDownload({
        bucket: file.bucket,
        key: file.key,
        expiresIn: 15 * 60,
        responseContentType: file.content_type,
      });
      outputUrl = signed.url;
    }
  }

  return {
    uuid: task.uuid,
    userUuid: task.user_uuid,
    type: task.type,
    status: task.status as TaskStatus,
    creditsUsed: task.credits_used,
    creditsTransNo: task.credits_trans_no,
    idempotencyKey: task.idempotency_key,
    jobUuid: task.job_uuid,
    userInput: task.user_input,
    outputUrl,
    outputFileUuid: task.output_file_uuid,
    outputJson: task.output_json,
    errorMessage: task.error_message,
    startedAt: task.started_at?.toISOString() ?? null,
    completedAt: task.completed_at?.toISOString() ?? null,
    createdAt: task.created_at.toISOString(),
    updatedAt: task.updated_at.toISOString(),
  };
}

export async function getTaskRecord(
  uuid: string,
  orgUuid: string,
): Promise<TaskRecord | undefined> {
  const task = await findTaskByUuid(uuid, orgUuid);
  return task ? toTaskRecord(task) : undefined;
}
