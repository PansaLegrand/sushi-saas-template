import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSnowId } from "@/lib/hash";
import { insertFile } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";
import type { CreateUploadRequest, CreateUploadResponse } from "@/types/storage";
import { logger as baseLogger, requestIdFromHeaders } from "@/lib/logger/server";
import { notifySlackError } from "@/integrations/slack";

const DEFAULT_MAX_UPLOAD_MB = Number(process.env.STORAGE_MAX_UPLOAD_MB || 25);

export async function POST(req: Request) {
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
      try {
        payload = (await req.json()) as any;
        parsedFrom = "json";
      } catch {
        // fall through to try formData
      }
    }

    if (!payload || Object.keys(payload).length === 0 || contentTypeHeader.includes("multipart/form-data")) {
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
      return respErr("missing filename/contentType/size");
    }

    const maxBytes = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;
    if (size > maxBytes) {
      return respErr(`file too large (>${DEFAULT_MAX_UPLOAD_MB}MB)`);
    }

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
      region: process.env.S3_REGION || process.env.STORAGE_REGION || null,
      endpoint: process.env.S3_ENDPOINT || process.env.STORAGE_ENDPOINT || null,
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
    baseLogger.error({ event: "storage.presign.create.error", error_name: (error as any)?.name, error_message: (error as any)?.message });
    notifySlackError("Storage: create upload failed", error, { route: "/api/storage/uploads", request_id: requestIdFromHeaders(req.headers) });
    return respErr("create upload failed", { status: 500 });
  }
}
