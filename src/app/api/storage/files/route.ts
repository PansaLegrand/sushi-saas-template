import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { getOrgContext } from "@/services/authz";
import { listFilesByOrg } from "@/models/file";

export async function GET(req: Request) {
  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");

    const rows = await listFilesByOrg(ctx.orgUuid, Math.max(page, 1), Math.max(limit, 1));
    return respData({ items: rows });
  } catch (error) {
    return respError(error, {
      logFields: { event: "storage.files_list_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
