import { AppError } from "@/lib/errors/app-error";
import {
  reserveFileWithinQuota,
  type FileInsert,
} from "@/models/file";
import type { OrgUuid } from "@/models/organization";
import { enforceLimit, limitOf } from "@/services/entitlements";

import { cleanupStaleUploads } from "./cleanup";

const BYTES_PER_MB = 1024 * 1024;

/**
 * Reserve total-storage quota and the upload row as one effect.
 *
 * The plan is resolved before the transaction, while the model performs the
 * usage sum and insert under the organization lock. A concurrent request may
 * change the usage, so a refusal reports the value observed inside that same
 * transaction.
 */
export async function reserveStorageUpload(
  orgUuid: OrgUuid,
  data: FileInsert & { size: number }
) {
  await cleanupStaleUploads({ orgUuid });

  const maxMb = await limitOf(orgUuid, "storage.totalMb");
  const outcome = await reserveFileWithinQuota(
    data,
    maxMb === null ? null : maxMb * BYTES_PER_MB
  );

  if (outcome.ok) return outcome.file;

  // This is expected to throw and gives the client the normal plan-limit
  // details. Fractional MB keeps the decision byte-accurate.
  await enforceLimit(orgUuid, "storage.totalMb", {
    current: outcome.usedBytes / BYTES_PER_MB,
    adding: data.size / BYTES_PER_MB,
  });

  // Defensive: a finite limit refused the model insert, so reaching here would
  // mean the entitlement catalog changed between the two reads.
  throw new AppError("PLAN_LIMIT_EXCEEDED", {
    message: "storage quota changed while reserving an upload",
  });
}
