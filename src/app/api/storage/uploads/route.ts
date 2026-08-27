import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { toAppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "@/lib/http/request";
import { getOrgContext } from "@/services/authz";
import { createStorageUpload } from "@/services/storage/uploads";
import {
  STORAGE_UPLOAD_POLICY_IDS,
  STORAGE_UPLOAD_VISIBILITIES,
} from "@/config/storage";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import {
  logger as baseLogger,
  requestIdFromHeaders,
} from "@/lib/logger/server";
import { notifySlackError } from "@/integrations/slack";

const ContentTypeField = z.string().trim().max(255).optional();

const CreateUploadSchema = z.object({
  filename: z.string().trim().max(255).optional(),
  name: z.string().trim().max(255).optional(),
  contentType: ContentTypeField,
  type: ContentTypeField,
  mimeType: ContentTypeField,
  mime: ContentTypeField,
  size: z.coerce.number().positive().optional(),
  checksumSha256: z.string().trim().optional(),
  policy: z.enum(STORAGE_UPLOAD_POLICY_IDS).optional(),
  visibility: z.enum(STORAGE_UPLOAD_VISIBILITIES).optional(),
  metadata: z.record(z.string()).optional(),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;

  try {
    const requestId = requestIdFromHeaders(req.headers);
    const log = baseLogger.child({
      request_id: requestId,
      route: "/api/storage/uploads",
    });
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();
    const userUuid = ctx.userUuid;

    const contentTypeHeader = req.headers.get("content-type") || "";
    if (!contentTypeHeader.toLowerCase().includes("application/json")) {
      return respCode("REQUEST_UNSUPPORTED_MEDIA_TYPE");
    }
    const payload = await parseJsonBody(req, CreateUploadSchema);

    // Normalize alternate property names
    const filename = payload.filename || payload.name;
    const contentType =
      payload.contentType || payload.type || payload.mimeType || payload.mime;
    const {
      size,
      checksumSha256,
      policy: policyValue,
      visibility,
      metadata,
    } = payload;

    if (!filename || !contentType || !size || Number(size) <= 0) {
      // Keep message consistent but add hint for developers
      baseLogger.warn({
        event: "storage.presign.create.invalid",
        parsed_from: "json",
        filename,
        contentType,
        size,
      });
      return respCode("REQUEST_MISSING_FIELD", {
        details: { fields: ["filename", "contentType", "size"] },
      });
    }

    const result = await createStorageUpload({
      orgUuid: ctx.orgUuid,
      userUuid,
      filename,
      contentType,
      size,
      checksumSha256,
      policy: policyValue,
      visibility,
      metadata,
    });
    log.info({
      event: "storage.presign.create",
      user_id: userUuid,
      file_id: result.upload.fileUuid,
      key: result.upload.key,
      bucket: result.upload.bucket,
      size,
      content_type: result.contentType,
      status: "ok",
    });
    return respData(result.upload);
  } catch (error) {
    const appError = toAppError(error, "STORAGE_UPLOAD_FAILED");
    if (appError.statusCode >= 500) {
      baseLogger.error({
        event: "storage.presign.create.error",
        error_name: error instanceof Error ? error.name : "UnknownError",
        error_message:
          error instanceof Error ? error.message : "upload creation failed",
      });
      notifySlackError("Storage: create upload failed", error, {
        route: "/api/storage/uploads",
        request_id: requestIdFromHeaders(req.headers),
      });
    }
    return respError(appError, {
      logFields: { event: "storage.presign.create_failed" },
      fallback: "STORAGE_UPLOAD_FAILED",
    });
  }
}
