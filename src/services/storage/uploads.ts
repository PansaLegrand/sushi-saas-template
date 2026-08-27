import {
  DEFAULT_STORAGE_UPLOAD_POLICY_ID,
  extensionForFilename,
  getStorageUploadPolicy,
  isAllowedUploadType,
  isSha256Checksum,
  normalizeContentType,
  type StorageUploadPolicyId,
  type StorageUploadVisibility,
} from "@/config/storage";
import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { newId } from "@/lib/ids";
import { reserveFileWithinQuota, type FileInsert } from "@/models/file";
import type { OrgUuid } from "@/models/organization";
import {
  enforceLimit,
  limitOf,
  requireEntitlement,
} from "@/services/entitlements";
import type { CreateUploadResponse } from "@/types/storage";

import { cleanupStaleUploads } from "./cleanup";
import { getStorageAdapter } from "./index";

const BYTES_PER_MB = 1024 * 1024;

export type CreateStorageUploadInput = {
  orgUuid: OrgUuid;
  userUuid: string;
  filename: string;
  contentType: string;
  size: number;
  checksumSha256?: string;
  policy?: StorageUploadPolicyId;
  visibility?: StorageUploadVisibility;
  metadata?: Record<string, string>;
};

export type CreateStorageUploadResult = {
  upload: CreateUploadResponse;
  contentType: string;
};

/** Validate upload policy, reserve quota, and issue one provider upload URL. */
export async function createStorageUpload(
  input: CreateStorageUploadInput,
): Promise<CreateStorageUploadResult> {
  const policy = getStorageUploadPolicy(
    input.policy ?? DEFAULT_STORAGE_UPLOAD_POLICY_ID,
  );
  const contentType = normalizeContentType(input.contentType);
  const extension = extensionForFilename(input.filename);

  if (!isAllowedUploadType(policy, { filename: input.filename, contentType })) {
    throw new AppError("STORAGE_FILE_TYPE_NOT_ALLOWED", {
      message: `upload type is not allowed by policy ${policy.id}`,
      details: {
        policy: policy.id,
        allowedContentTypes: policy.allowedContentTypes,
        allowedExtensions: policy.allowedExtensions,
      },
    });
  }
  if (input.checksumSha256 && !isSha256Checksum(input.checksumSha256)) {
    throw new AppError("STORAGE_CHECKSUM_INVALID", {
      message: "upload checksum is not base64-encoded SHA-256",
      details: { field: "checksumSha256" },
    });
  }
  if (policy.requireChecksum && !input.checksumSha256) {
    throw new AppError("STORAGE_CHECKSUM_REQUIRED", {
      message: `upload policy ${policy.id} requires a checksum`,
      details: { policy: policy.id },
    });
  }

  await requireEntitlement(input.orgUuid, "storage.upload");
  const planMaxMb = await limitOf(input.orgUuid, "storage.maxFileMb");
  const effectiveMaxMb = Math.min(
    getAppEnv().STORAGE_MAX_UPLOAD_MB,
    ...(planMaxMb === null ? [] : [planMaxMb]),
    ...(policy.maxFileMb === undefined ? [] : [policy.maxFileMb]),
  );
  const maxBytes = effectiveMaxMb * BYTES_PER_MB;
  if (input.size > maxBytes) {
    throw new AppError("STORAGE_FILE_TOO_LARGE", {
      message: `upload size ${input.size} exceeds ${maxBytes} bytes`,
      details: { maxBytes },
    });
  }

  const storage = getStorageAdapter();
  const bucket = storage.getDefaultBucket();
  const key = storage.buildObjectKey({
    userUuid: input.userUuid,
    filename: input.filename,
  });
  const fileUuid = newId();

  await reserveStorageUpload(input.orgUuid, {
    org_uuid: input.orgUuid,
    uuid: fileUuid,
    user_uuid: input.userUuid,
    provider: storage.provider,
    bucket,
    key,
    region: getAppEnv().STORAGE_REGION || null,
    endpoint: getAppEnv().STORAGE_ENDPOINT || null,
    original_filename: input.filename,
    extension: extension.slice(1),
    content_type: contentType,
    size: input.size,
    visibility: input.visibility ?? "private",
    status: "uploading",
    checksum_sha256: input.checksumSha256 ?? null,
    metadata_json: JSON.stringify({
      ...(input.metadata ?? {}),
      upload_policy: policy.id,
    }),
  });

  const signed = await storage.getPresignedUpload({
    bucket,
    key,
    contentType,
    size: input.size,
    checksumSha256: input.checksumSha256,
    metadata: input.metadata,
    expiresIn: 15 * 60,
  });

  return {
    upload: { ...signed, fileUuid },
    contentType,
  };
}

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
  data: FileInsert & { size: number },
) {
  await cleanupStaleUploads({ orgUuid });

  const maxMb = await limitOf(orgUuid, "storage.totalMb");
  const outcome = await reserveFileWithinQuota(
    data,
    maxMb === null ? null : maxMb * BYTES_PER_MB,
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
