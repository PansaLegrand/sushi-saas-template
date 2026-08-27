import { AppError } from "@/lib/errors/app-error";
import {
  activateUploadingFile,
  findFileByUuid,
  type FilePatch,
  type FileRow,
} from "@/models/file";

import { getStorageAdapter } from "./index";
import { requestFileDeletion } from "./delete-request";

/** Verify the provider object and atomically activate its pending file row. */
export async function completeStorageUpload(
  orgUuid: string,
  fileUuid: string,
): Promise<FileRow> {
  const file = await findFileByUuid(fileUuid, orgUuid);
  if (!file) {
    throw new AppError("STORAGE_FILE_NOT_FOUND", {
      message: `upload file not found: ${fileUuid}`,
    });
  }
  if (file.status === "active") return file;

  const head = await getStorageAdapter().headObject({
    bucket: file.bucket,
    key: file.key,
  });
  if (!head) {
    throw new AppError("STORAGE_OBJECT_MISSING", {
      message: `uploaded object is missing: ${file.bucket}/${file.key}`,
    });
  }

  const providerPatch: FilePatch = {
    size: head.size || file.size,
    etag: head.etag ?? null,
    content_type: head.contentType ?? file.content_type,
    checksum_sha256: head.checksumSHA256 ?? file.checksum_sha256 ?? null,
    storage_class: head.storageClass ?? null,
  };

  if (file.size && head.size && head.size !== file.size) {
    await rejectUpload(file, orgUuid, {
      ...providerPatch,
      size: head.size,
      checksum_sha256: head.checksumSHA256 ?? null,
    });
    throw new AppError("STORAGE_SIZE_MISMATCH", {
      message: `uploaded object size ${head.size} does not match reserved size ${file.size}`,
    });
  }

  if (
    file.checksum_sha256 &&
    head.checksumSHA256 &&
    head.checksumSHA256 !== file.checksum_sha256
  ) {
    await rejectUpload(file, orgUuid, {
      ...providerPatch,
      checksum_sha256: head.checksumSHA256,
    });
    throw new AppError("STORAGE_CHECKSUM_MISMATCH", {
      message: `uploaded object checksum does not match file ${file.uuid}`,
    });
  }

  const active = await activateUploadingFile(file.uuid, orgUuid, providerPatch);
  if (!active) {
    throw new AppError("STORAGE_UPLOAD_STATE_CONFLICT", {
      message: `upload file changed state before activation: ${file.uuid}`,
    });
  }

  return active;
}

async function rejectUpload(
  file: FileRow,
  orgUuid: string,
  patch: FilePatch,
): Promise<void> {
  await requestFileDeletion(file, orgUuid, {
    expectedStatuses: ["uploading"],
    patch,
  });
}
