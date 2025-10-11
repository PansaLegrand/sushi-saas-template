import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { findFileByUuid, updateFileByUuid } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";
import type { CompleteUploadRequest } from "@/types/storage";
import { notifySlackError } from "@/integrations/slack";

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    let payload: CompleteUploadRequest;
    try {
      payload = (await req.json()) as CompleteUploadRequest;
    } catch {
      return respErr("invalid json");
    }

    const { fileUuid } = payload;
    if (!fileUuid) return respErr("missing fileUuid");

    const file = await findFileByUuid(fileUuid);
    if (!file || file.user_uuid !== userUuid) {
      return respErr("file not found", { status: 404 });
    }

    if (file.status === "active") {
      return respData({ ok: true, file });
    }

    const storage = getStorageAdapter();
    const head = await storage.headObject({ bucket: file.bucket, key: file.key });
    if (!head) {
      return respErr("object not found in storage", { status: 404 });
    }

    // Basic size match validation
    if (file.size && head.size && head.size !== file.size) {
      // Update anyway with head values but report mismatch
      await updateFileByUuid(file.uuid, {
        size: head.size,
        etag: head.etag ?? null,
        content_type: head.contentType ?? file.content_type,
        checksum_sha256: head.checksumSHA256 ?? null,
        storage_class: head.storageClass ?? null,
        status: "failed",
      });
      return respErr("uploaded size mismatch");
    }

    const updated = await updateFileByUuid(file.uuid, {
      size: head.size || file.size,
      etag: head.etag ?? null,
      content_type: head.contentType ?? file.content_type,
      checksum_sha256: head.checksumSHA256 ?? null,
      storage_class: head.storageClass ?? null,
      status: "active",
    });

    return respData({ ok: true, file: updated ?? file });
  } catch (error) {
    console.error("complete upload failed", error);
    notifySlackError("Storage: complete upload failed", error);
    return respErr("complete upload failed", { status: 500 });
  }
}
