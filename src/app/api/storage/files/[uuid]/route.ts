import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { getOrgContext } from "@/services/authz";
import { findFileByUuid } from "@/models/file";
import { getStorageAdapter } from "@/services/storage";
import { requestFileDeletion } from "@/services/storage/delete-request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;

  try {
    const org = await getOrgContext(req);
    if (!org) return respNoAuth();

    const { uuid } = await ctx.params;
    const file = await findFileByUuid(uuid, org.orgUuid);
    if (!file) {
      return respCode("STORAGE_FILE_NOT_FOUND");
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
    return respError(error, {
      logFields: { event: "storage.file_get_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;

  try {
    const org = await getOrgContext(req);
    if (!org) return respNoAuth();

    const { uuid } = await ctx.params;
    const file = await findFileByUuid(uuid, org.orgUuid);
    if (!file) {
      return respCode("STORAGE_FILE_NOT_FOUND");
    }

    const deletion = await requestFileDeletion(file, org.orgUuid);
    return respData({ ok: true, ...deletion });
  } catch (error) {
    return respError(error, {
      logFields: { event: "storage.file_delete_failed" },
      fallback: "STORAGE_UPLOAD_FAILED",
    });
  }
}
