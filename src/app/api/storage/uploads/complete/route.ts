import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { toAppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "@/lib/http/request";
import { getOrgContext } from "@/services/authz";
import { activateUploadingFile, findFileByUuid } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";
import { notifySlackError } from "@/integrations/slack";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { requestFileDeletion } from "@/services/storage/delete-request";

const CompleteUploadSchema = z.object({
  fileUuid: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const { fileUuid } = await parseJsonBody(req, CompleteUploadSchema);

    const file = await findFileByUuid(fileUuid, ctx.orgUuid);
    if (!file) {
      return respCode("STORAGE_FILE_NOT_FOUND");
    }

    if (file.status === "active") {
      return respData({ ok: true, file });
    }

    const storage = getStorageAdapter();
    const head = await storage.headObject({
      bucket: file.bucket,
      key: file.key,
    });
    if (!head) {
      return respCode("STORAGE_OBJECT_MISSING");
    }

    // Basic size match validation
    if (file.size && head.size && head.size !== file.size) {
      await requestFileDeletion(file, ctx.orgUuid, {
        expectedStatuses: ["uploading"],
        patch: {
          size: head.size,
          etag: head.etag ?? null,
          content_type: head.contentType ?? file.content_type,
          checksum_sha256: head.checksumSHA256 ?? null,
          storage_class: head.storageClass ?? null,
        },
      });
      return respCode("STORAGE_SIZE_MISMATCH");
    }

    if (
      file.checksum_sha256 &&
      head.checksumSHA256 &&
      head.checksumSHA256 !== file.checksum_sha256
    ) {
      await requestFileDeletion(file, ctx.orgUuid, {
        expectedStatuses: ["uploading"],
        patch: {
          size: head.size || file.size,
          etag: head.etag ?? null,
          content_type: head.contentType ?? file.content_type,
          checksum_sha256: head.checksumSHA256,
          storage_class: head.storageClass ?? null,
        },
      });
      return respCode("STORAGE_CHECKSUM_MISMATCH");
    }

    const updated = await activateUploadingFile(file.uuid, ctx.orgUuid, {
      size: head.size || file.size,
      etag: head.etag ?? null,
      content_type: head.contentType ?? file.content_type,
      checksum_sha256: head.checksumSHA256 ?? file.checksum_sha256 ?? null,
      storage_class: head.storageClass ?? null,
    });
    if (!updated) {
      return respCode("STORAGE_UPLOAD_STATE_CONFLICT");
    }

    return respData({ ok: true, file: updated });
  } catch (error) {
    const appError = toAppError(error, "STORAGE_UPLOAD_FAILED");
    if (appError.statusCode >= 500) {
      notifySlackError("Storage: complete upload failed", error);
    }
    return respError(appError, {
      logFields: { event: "storage.upload_complete_failed" },
      fallback: "STORAGE_UPLOAD_FAILED",
    });
  }
}
