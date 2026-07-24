import { requireAdminRead } from "@admin/lib/authz";
import { respData, respErr, respNotFound } from "@/lib/resp";
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
    if (!uuid) return respErr("uuid required");

    // Without this check an unknown uuid yields a zeroed summary that reads
    // like a real user holding no credits.
    const user = await findUserByUuid(uuid);
    if (!user) return respNotFound("user not found");

    const summary = await getUserCreditSummary(uuid, {
      includeLedger: true,
      ledgerLimit: 100,
    });
    return respData(summary);
  } catch (e) {
    console.error("admin get user credits failed", e);
    return respErr("admin get user credits failed", { status: 500 });
  }
}
