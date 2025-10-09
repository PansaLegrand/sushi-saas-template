import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { findFileByUuid, softDeleteFile } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    const { uuid } = await ctx.params;
    const file = await findFileByUuid(uuid);
    if (!file || file.user_uuid !== userUuid) {
      return respErr("file not found", { status: 404 });
    }

    const url = new URL(req.url);
    const wantDownload = url.searchParams.get("download") === "1";
    const expiresInParam = url.searchParams.get("expiresIn");
    const disposition = url.searchParams.get("disposition"); // inline | attachment
    const responseType = url.searchParams.get("contentType");
    const expiresIn = (() => {
      const n = expiresInParam ? Number(expiresInParam) : NaN;
      if (Number.isFinite(n)) {
        // clamp between 60s and 24h
        return Math.max(60, Math.min(24 * 60 * 60, Math.floor(n)));
      }
      return 15 * 60;
    })();
    const storage = getStorageAdapter();

    let downloadUrl: string | undefined;
    if (wantDownload && file.status === "active") {
      const signed = await storage.getPresignedDownload({
        bucket: file.bucket,
        key: file.key,
        filename:
          disposition === "inline"
            ? undefined
            : file.original_filename, // force download unless inline requested
        expiresIn,
        responseContentType: responseType ?? file.content_type,
      });
      downloadUrl = signed.url;
    }

    return respData({ file, downloadUrl });
  } catch (error) {
    console.error("get file failed", error);
    return respErr("get file failed");
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    const { uuid } = await ctx.params;
    const file = await findFileByUuid(uuid);
    if (!file || file.user_uuid !== userUuid) {
      return respErr("file not found", { status: 404 });
    }

    const storage = getStorageAdapter();
    try {
      await storage.deleteObject({ bucket: file.bucket, key: file.key });
    } catch (e) {
      // Ignore storage delete errors; still soft-delete the record
      console.warn("storage delete failed", e);
    }

    const deleted = await softDeleteFile(file.uuid);
    return respData({ ok: true, file: deleted ?? file });
  } catch (error) {
    console.error("delete file failed", error);
    return respErr("delete file failed");
  }
}
