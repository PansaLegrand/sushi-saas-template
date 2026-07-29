import { findFileByUuid, softDeleteFile } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";

/**
 * Idempotent queue worker: a retry after successful object deletion sees the
 * row as deleted and exits; S3-compatible DeleteObject is itself idempotent.
 */
export async function deleteStoredObject(input: {
  fileUuid: string;
  orgUuid: string;
}): Promise<void> {
  const file = await findFileByUuid(input.fileUuid, input.orgUuid);
  if (!file || file.status === "deleted") return;

  const storage = getStorageAdapter();
  await storage.deleteObject({ bucket: file.bucket, key: file.key });
  await softDeleteFile(file.uuid, input.orgUuid);
}
