import { listStaleUploadingFiles } from "@/models/file";
import { requestFileDeletion } from "@/services/storage/delete-request";

export const STALE_UPLOAD_AFTER_MS = 60 * 60 * 1000;

export function staleUploadCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_UPLOAD_AFTER_MS);
}

export async function cleanupStaleUploads(
  params: {
    orgUuid?: string;
    now?: Date;
  } = {},
): Promise<number> {
  const stale = await listStaleUploadingFiles({
    orgUuid: params.orgUuid,
    cutoff: staleUploadCutoff(params.now),
  });

  let scheduled = 0;
  for (const file of stale) {
    const outcome = await requestFileDeletion(file, file.org_uuid, {
      // Completion may have won after the stale list was read. Never delete an
      // object that became active in that window.
      expectedStatuses: ["uploading"],
    });
    if (outcome.file.status === "deleting") scheduled += 1;
  }

  return scheduled;
}
