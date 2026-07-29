import { scheduleFileDeletion } from "@/models/file";

/**
 * Move a file out of the readable state and durably schedule object deletion.
 *
 * The database row does not become `deleted` until the storage provider
 * confirms deletion. That keeps quota accounting honest during an outage and
 * gives the queue a visible state to retry.
 */
export async function requestFileDeletion(
  file: { uuid: string; status: string },
  orgUuid: string,
  options: {
    expectedStatuses?: readonly string[];
    patch?: Parameters<typeof scheduleFileDeletion>[0]["patch"];
  } = {},
) {
  if (file.status === "deleted") return { file, queued: false };

  const scheduled = await scheduleFileDeletion({
    uuid: file.uuid,
    orgUuid,
    expectedStatuses: options.expectedStatuses,
    patch: options.patch,
    maxAttempts: 10,
  });

  return scheduled ?? { file, queued: false };
}
