import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getOrgContext } from "@/services/authz";
import { getTaskRecord } from "@/services/tasks/presentation";

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  const limited = await rateLimitOrThrow(req, "tasks");
  if (limited) return limited;

  try {
    const org = await getOrgContext(req);
    if (!org) return respNoAuth();

    const { uuid } = await ctx.params;
    if (!uuid) return respCode("REQUEST_MISSING_FIELD", {
      details: { field: "uuid" },
    });

    const task = await getTaskRecord(uuid, org.orgUuid);
    if (!task) return respCode("TASK_NOT_FOUND");

    return respData({ task });
  } catch (error) {
    return respError(error, {
      logFields: { event: "task.get_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
