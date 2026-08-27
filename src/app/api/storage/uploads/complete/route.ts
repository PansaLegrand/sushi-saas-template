import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { toAppError } from "@/lib/errors/app-error";
import { parseJsonBody } from "@/lib/http/request";
import { getOrgContext } from "@/services/authz";
import { notifySlackError } from "@/integrations/slack";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { completeStorageUpload } from "@/services/storage/complete-upload";

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

    const updated = await completeStorageUpload(ctx.orgUuid, fileUuid);

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
