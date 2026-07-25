import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { toAppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "@/lib/http/request";
import { getUserUuid } from "@/services/user";
import { getSnowId } from "@/lib/hash";
import { insertFile, sumFileBytesByUser } from "@/models/file";
import { enforceLimit, limitOf, requireEntitlement } from "@/services/entitlements";
import { getStorageAdapter } from "@/services/storage";
import { getAppEnv } from "@/lib/env";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import type { CreateUploadRequest, CreateUploadResponse } from "@/types/storage";
import { logger as baseLogger, requestIdFromHeaders } from "@/lib/logger/server";
import { notifySlackError } from "@/integrations/slack";

const DEFAULT_MAX_UPLOAD_MB = getAppEnv().STORAGE_MAX_UPLOAD_MB;

const CreateUploadSchema = z.object({
  filename: z.string().trim().optional(),
  name: z.string().trim().optional(),
  contentType: z.string().trim().optional(),
  type: z.string().trim().optional(),
  mimeType: z.string().trim().optional(),
  mime: z.string().trim().optional(),
  size: z.coerce.number().positive().optional(),
  checksumSha256: z.string().trim().optional(),
  visibility: z.enum(["public", "private", "org"]).optional(),
  metadata: z.record(z.string()).optional(),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;

  try {
    const requestId = requestIdFromHeaders(req.headers);
    const log = baseLogger.child({ request_id: requestId, route: "/api/storage/uploads" });
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    // Accept both JSON and multipart/form-data for convenience
    let payload: Partial<CreateUploadRequest> &
      Partial<{ name: string; type: string; mimeType: string; mime: string } & { file?: File }> = {};

    const contentTypeHeader = req.headers.get("content-type") || "";
    let parsedFrom: "json" | "form" | "unknown" = "unknown";

    if (contentTypeHeader.includes("application/json")) {
      payload = await parseJsonBody(req, CreateUploadSchema);
      parsedFrom = "json";
    }

    if (
      contentTypeHeader.includes("multipart/form-data") ||
      (!contentTypeHeader.includes("application/json") &&
        (!payload || Object.keys(payload).length === 0))
    ) {
      try {
        const form = await req.formData();
        const file = form.get("file");
        if (file && typeof file === "object" && "name" in file && "size" in file) {
          payload.filename = (file as any).name as string;
          payload.contentType = ((file as any).type as string) || "application/octet-stream";
          payload.size = Number(((file as any).size as number) || 0);
          // optional metadata fields
          const checksum = form.get("checksumSha256");
          if (typeof checksum === "string") payload.checksumSha256 = checksum;
          const visibility = form.get("visibility");
          if (visibility === "public" || visibility === "private" || visibility === "org") payload.visibility = visibility;
          const metadataRaw = form.get("metadata");
          if (typeof metadataRaw === "string") {
            try {
              payload.metadata = JSON.parse(metadataRaw);
            } catch {}
          }
          parsedFrom = "form";
        } else {
          // allow explicit fields in form
          const fname = form.get("filename") || form.get("name");
          const ctype = form.get("contentType") || form.get("type") || form.get("mimeType") || form.get("mime");
          const sz = form.get("size");
          if (typeof fname === "string") payload.filename = fname;
          if (typeof ctype === "string") payload.contentType = ctype;
          if (typeof sz === "string") payload.size = Number(sz);
          parsedFrom = "form";
        }
      } catch {
        // ignore and validate below
      }
    }

    // Normalize alternate property names
    const filename = (payload as any).filename || (payload as any).name;
    const contentType =
      (payload as any).contentType || (payload as any).type || (payload as any).mimeType || (payload as any).mime;
    const size = typeof (payload as any).size === "string" ? Number((payload as any).size) : (payload as any).size;
    const checksumSha256 = (payload as any).checksumSha256;
    const visibility = (payload as any).visibility;
    const metadata = (payload as any).metadata;

    if (!filename || !contentType || !size || Number(size) <= 0) {
      // Keep message consistent but add hint for developers
      baseLogger.warn({ event: "storage.presign.create.invalid", parsedFrom, filename, contentType, size });
      return respCode("REQUEST_MISSING_FIELD", {
        details: { fields: ["filename", "contentType", "size"] },
      });
    }

    // Two independent caps, and the smaller wins.
    //
    // The env var is an infrastructure ceiling — what this deployment will
    // accept at all, whatever anyone is paying. The plan limit is a product
    // decision. Keeping them separate means raising a tier's allowance never
    // silently raises what the server will accept from an unpaid account.
    await requireEntitlement(userUuid, "storage.upload");

    const planMaxMb = await limitOf(userUuid, "storage.maxFileMb");
    const effectiveMaxMb =
      planMaxMb === null ? DEFAULT_MAX_UPLOAD_MB : Math.min(DEFAULT_MAX_UPLOAD_MB, planMaxMb);
    const maxBytes = effectiveMaxMb * 1024 * 1024;

    if (size > maxBytes) {
      return respCode("STORAGE_FILE_TOO_LARGE", {
        details: { maxBytes },
      });
    }

    // Total-storage quota. Checked against what is already stored plus what
    // this upload would add, at creation time only — a user who downgrades
    // below what they already hold keeps their files and is simply refused new
    // ones. Nothing here deletes data because a plan changed.
    const usedBytes = await sumFileBytesByUser(userUuid);
    await enforceLimit(userUuid, "storage.totalMb", {
      current: Math.round(usedBytes / (1024 * 1024)),
      adding: Math.ceil(Number(size) / (1024 * 1024)),
    });

    const storage = getStorageAdapter();
    const bucket = storage.getDefaultBucket();
    const key = storage.buildObjectKey({ userUuid, filename });

    // Reserve a record in DB with status 'uploading'
    const fileUuid = getSnowId();
    await insertFile({
      uuid: fileUuid,
      user_uuid: userUuid,
      provider: storage.provider,
      bucket,
      key,
      region: getAppEnv().STORAGE_REGION || null,
      endpoint: getAppEnv().STORAGE_ENDPOINT || null,
      original_filename: filename,
      extension: filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "",
      content_type: contentType,
      size: Number(size),
      visibility: (visibility as any) ?? "private",
      status: "uploading",
      metadata_json: metadata ? JSON.stringify(metadata) : null,
    });

    const signed = await storage.getPresignedUpload({
      bucket,
      key,
      contentType,
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
      content_type: contentType,
      status: "ok",
    });
    return respData(res);
  } catch (error) {
    const appError = toAppError(error, "STORAGE_UPLOAD_FAILED");
    if (appError.statusCode >= 500) {
      baseLogger.error({ event: "storage.presign.create.error", error_name: (error as any)?.name, error_message: (error as any)?.message });
      notifySlackError("Storage: create upload failed", error, { route: "/api/storage/uploads", request_id: requestIdFromHeaders(req.headers) });
    }
    return respError(appError, {
      logFields: { event: "storage.presign.create_failed" },
      fallback: "STORAGE_UPLOAD_FAILED",
    });
  }
}
