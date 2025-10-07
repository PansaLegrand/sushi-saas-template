import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSnowId } from "@/lib/hash";
import { insertFile } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";
import type { CreateUploadRequest, CreateUploadResponse } from "@/types/storage";

const DEFAULT_MAX_UPLOAD_MB = Number(process.env.STORAGE_MAX_UPLOAD_MB || 25);

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    let payload: CreateUploadRequest;
    try {
      payload = (await req.json()) as CreateUploadRequest;
    } catch {
      return respErr("invalid json");
    }

    const { filename, contentType, size } = payload;
    if (!filename || !contentType || !size || size <= 0) {
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
      size: size,
      visibility: payload.visibility ?? "private",
      status: "uploading",
      metadata_json: payload.metadata ? JSON.stringify(payload.metadata) : null,
    });

    const signed = await storage.getPresignedUpload({
      bucket,
      key,
      contentType,
      size,
      checksumSha256: payload.checksumSha256,
      metadata: payload.metadata,
      expiresIn: 15 * 60,
    });

    const res: CreateUploadResponse = {
      ...signed,
      fileUuid,
    };

    return respData(res);
  } catch (error) {
    console.error("create upload failed", error);
    return respErr("create upload failed");
  }
}
