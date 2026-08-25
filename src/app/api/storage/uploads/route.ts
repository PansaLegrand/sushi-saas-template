import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { toAppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "@/lib/http/request";
import { getOrgContext } from "@/services/authz";
import { newId } from "@/lib/ids";
import { limitOf, requireEntitlement } from "@/services/entitlements";
import { getStorageAdapter } from "@/services/storage";
import { reserveStorageUpload } from "@/services/storage/uploads";
import { getAppEnv } from "@/lib/env";
import {
  DEFAULT_STORAGE_UPLOAD_POLICY_ID,
  STORAGE_UPLOAD_POLICY_IDS,
  STORAGE_UPLOAD_VISIBILITIES,
  extensionForFilename,
  getStorageUploadPolicy,
  isAllowedUploadType,
  isSha256Checksum,
  normalizeContentType,
} from "@/config/storage";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import type { CreateUploadResponse } from "@/types/storage";
import {
  logger as baseLogger,
  requestIdFromHeaders,
} from "@/lib/logger/server";
import { notifySlackError } from "@/integrations/slack";

const DEFAULT_MAX_UPLOAD_MB = getAppEnv().STORAGE_MAX_UPLOAD_MB;

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

function metadataWithPolicy(
  metadata: Record<string, string> | undefined,
  policyId: string,
): Record<string, string> {
  return {
    ...(metadata ?? {}),
    upload_policy: policyId,
  };
}

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

    const policyId = policyValue ?? DEFAULT_STORAGE_UPLOAD_POLICY_ID;
    const policy = getStorageUploadPolicy(policyId);
    const normalizedContentType = normalizeContentType(contentType);
    const extension = extensionForFilename(filename);

    if (
      !isAllowedUploadType(policy, {
        filename,
        contentType: normalizedContentType,
      })
    ) {
      return respCode("STORAGE_FILE_TYPE_NOT_ALLOWED", {
        details: {
          policy: policy.id,
          allowedContentTypes: policy.allowedContentTypes,
          allowedExtensions: policy.allowedExtensions,
        },
      });
    }

    if (checksumSha256 && !isSha256Checksum(checksumSha256)) {
      return respCode("STORAGE_CHECKSUM_INVALID", {
        details: { field: "checksumSha256" },
      });
    }

    if (policy.requireChecksum && !checksumSha256) {
      return respCode("STORAGE_CHECKSUM_REQUIRED", {
        details: { policy: policy.id },
      });
    }

    // Two independent caps, and the smaller wins.
    //
    // The env var is an infrastructure ceiling — what this deployment will
    // accept at all, whatever anyone is paying. The plan limit is a product
    // decision. Keeping them separate means raising a tier's allowance never
    // silently raises what the server will accept from an unpaid account.
    await requireEntitlement(ctx.orgUuid, "storage.upload");

    const planMaxMb = await limitOf(ctx.orgUuid, "storage.maxFileMb");
    const effectiveMaxMb = Math.min(
      DEFAULT_MAX_UPLOAD_MB,
      ...(planMaxMb === null ? [] : [planMaxMb]),
      ...(policy.maxFileMb === undefined ? [] : [policy.maxFileMb]),
    );
    const maxBytes = effectiveMaxMb * 1024 * 1024;

    if (size > maxBytes) {
      return respCode("STORAGE_FILE_TOO_LARGE", {
        details: { maxBytes },
      });
    }

    const storage = getStorageAdapter();
    const bucket = storage.getDefaultBucket();
    const key = storage.buildObjectKey({ userUuid, filename });

    // Reserve a record in DB with status 'uploading'
    const fileUuid = newId();
    await reserveStorageUpload(ctx.orgUuid, {
      org_uuid: ctx.orgUuid,
      uuid: fileUuid,
      user_uuid: userUuid,
      provider: storage.provider,
      bucket,
      key,
      region: getAppEnv().STORAGE_REGION || null,
      endpoint: getAppEnv().STORAGE_ENDPOINT || null,
      original_filename: filename,
      extension: extension.slice(1),
      content_type: normalizedContentType,
      size,
      visibility: visibility ?? "private",
      status: "uploading",
      checksum_sha256: checksumSha256 ?? null,
      metadata_json: JSON.stringify(metadataWithPolicy(metadata, policy.id)),
    });

    const signed = await storage.getPresignedUpload({
      bucket,
      key,
      contentType: normalizedContentType,
      size,
      checksumSha256,
      metadata,
      expiresIn: 15 * 60,
    });

    const res: CreateUploadResponse = {
      ...signed,
      fileUuid,
    };
    log.info({
      event: "storage.presign.create",
      user_id: userUuid,
      file_id: fileUuid,
      key,
      bucket,
      size,
      content_type: normalizedContentType,
      status: "ok",
    });
    return respData(res);
  } catch (error) {
    const appError = toAppError(error, "STORAGE_UPLOAD_FAILED");
    if (appError.statusCode >= 500) {
      baseLogger.error({
        event: "storage.presign.create.error",
        error_name: (error as any)?.name,
        error_message: (error as any)?.message,
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
