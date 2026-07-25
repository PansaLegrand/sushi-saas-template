import { requireAdminRead } from "@admin/lib/authz";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { findUserByUuid } from "@/models/user";
import { getUserCreditSummary } from "@/services/credit";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> }
) {
  const authz = await requireAdminRead();
  if (authz instanceof Response) return authz;

  try {
    const { uuid } = await ctx.params;
    if (!uuid) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "uuid" },
      });
    }

    // Without this check an unknown uuid yields a zeroed summary that reads
    // like a real user holding no credits.
    const user = await findUserByUuid(uuid);
    if (!user) return respCode("ACCOUNT_NOT_FOUND");

    const summary = await getUserCreditSummary(uuid, {
      includeLedger: true,
      ledgerLimit: 100,
    });
    return respData(summary);
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.user_credits_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
