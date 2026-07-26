import { z } from "zod";

import { requireSameOrigin } from "@/lib/origin";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { getUserProfileByUuid } from "@/services/user";
import { getOrgContext } from "@/services/authz";

const UserInfoSchema = z.object({
  includeCreditLedger: z.boolean().optional(),
  creditLedgerLimit: z.coerce.number().int().positive().max(500).optional(),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) {
      return respNoAuth();
    }

    const payload = await parseJsonBody(req, UserInfoSchema, {
      defaultValue: {},
    });

    const profile = await getUserProfileByUuid(ctx.userUuid, ctx.orgUuid, {
      includeLedger: payload.includeCreditLedger,
      creditLedgerLimit: payload.creditLedgerLimit,
    });

    if (!profile) {
      return respCode("ACCOUNT_NOT_FOUND");
    }

    return respData(profile);
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.profile_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
