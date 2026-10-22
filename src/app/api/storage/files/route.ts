import { z } from "zod";
import { parseQuery } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { getOrgContext } from "@/services/authz";
import { listFilesPageByOrg } from "@/models/file";

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: Request) {
  const limited = await rateLimitOrThrow(req, "uploads");
  if (limited) return limited;
  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const { page, limit } = parseQuery(
      new URL(req.url).searchParams,
      PaginationSchema,
    );
    return respData(await listFilesPageByOrg(ctx.orgUuid, page, limit));
  } catch (error) {
    return respError(error, {
      logFields: { event: "storage.files_list_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
