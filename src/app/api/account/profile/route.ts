import { z } from "zod";

import { requireSameOrigin } from "@/lib/origin";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { getUserProfileByUuid } from "@/services/user";
import { getOrgContext } from "@/services/authz";
import { getAccountActorFromHeaders } from "@/services/account-lifecycle";
import { updateAccountName } from "@/services/account-settings";
import { rateLimitOrThrow } from "@/lib/rate-limit";

export async function PATCH(req: Request) {
  const invalid = requireSameOrigin(req);
  if (invalid) return invalid;
  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;
  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    const { name } = await parseJsonBody(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return respData(await updateAccountName(actor, req.headers, name));
  } catch (error) { return respError(error, { logFields: { event: "account.profile.update_failed" } }); }
}

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
