import { markStaleUploadingFilesFailed } from "@/models/file";

export const STALE_UPLOAD_AFTER_MS = 60 * 60 * 1000;

export function staleUploadCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_UPLOAD_AFTER_MS);
}

export async function cleanupStaleUploads(params: {
  orgUuid?: string;
  now?: Date;
} = {}): Promise<number> {
  return markStaleUploadingFilesFailed({
    orgUuid: params.orgUuid,
    cutoff: staleUploadCutoff(params.now),
  });
}
