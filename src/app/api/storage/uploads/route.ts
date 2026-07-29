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
  extensionForFilename,
  getStorageUploadPolicy,
  isAllowedUploadType,
  isSha256Checksum,
  isStorageUploadPolicyId,
  normalizeContentType,
} from "@/config/storage";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import type {
  CreateUploadRequest,
  CreateUploadResponse,
} from "@/types/storage";
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
  visibility: z.enum(["public", "private", "org"]).optional(),
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
    const payload: Partial<CreateUploadRequest> &
      Partial<{
        name: string;
        type: string;
        mimeType: string;
        mime: string;
      }> = await parseJsonBody(req, CreateUploadSchema);

    // Normalize alternate property names
    const filename = (payload as any).filename || (payload as any).name;
    const contentType =
      (payload as any).contentType ||
      (payload as any).type ||
      (payload as any).mimeType ||
      (payload as any).mime;
    const size =
      typeof (payload as any).size === "string"
        ? Number((payload as any).size)
        : (payload as any).size;
    const checksumSha256 = (payload as any).checksumSha256;
    const policyValue = (payload as any).policy;
    const visibility = (payload as any).visibility;
    const metadata = (payload as any).metadata;

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

    if (policyValue && !isStorageUploadPolicyId(policyValue)) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { fields: [{ field: "policy", code: "invalid_enum_value" }] },
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
      size: Number(size),
      visibility: (visibility as any) ?? "private",
      status: "uploading",
      checksum_sha256: checksumSha256 ?? null,
      metadata_json: JSON.stringify(metadataWithPolicy(metadata, policy.id)),
    });

    const signed = await storage.getPresignedUpload({
      bucket,
      key,
      contentType: normalizedContentType,
      size: Number(size),
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
      size: Number(size),
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
