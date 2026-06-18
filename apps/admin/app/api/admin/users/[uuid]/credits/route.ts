import { requireAdminRead } from "@/lib/authz";
import { respData, respErr } from "@/lib/resp";
import { getUserCreditSummary } from "@/services/credit";

export async function GET(_req: Request, { params }: any) {
  const authz = await requireAdminRead();
  if (authz instanceof Response) return authz;

  try {
    const { uuid } = params;
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
