import { z } from "zod";

import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { logger as baseLogger, requestIdFromHeaders } from "@/lib/logger/server";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { can, getOrgContext } from "@/services/authz";
import { createCheckoutSession } from "@/services/checkout";

const CheckoutSchema = z.object({
  product_id: z.string().trim().optional(),
  currency: z.enum(["usd", "cny"]).optional(),
  locale: z.string().trim().optional(),
});

const CheckoutIntentSchema = z.string().trim().min(1).max(255);

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const requestId = requestIdFromHeaders(req.headers);
    const body = await parseJsonBody(req, CheckoutSchema);
    const productId = body.product_id;

    if (!productId) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "product_id" },
      });
    }

    const ctx = await getOrgContext(req);
    if (!ctx) {
      return respNoAuth("no auth, please sign-in");
    }

    // The plan is bought by the organization and billed to its owner, so a
    // member cannot put a subscription on the team.
    if (!can(ctx, "billing:manage")) {
      return respCode("BILLING_OWNER_ONLY");
    }

    const rawCheckoutIntentId = req.headers.get("idempotency-key");
    if (!rawCheckoutIntentId) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "Idempotency-Key" },
      });
    }

    const parsedCheckoutIntent = CheckoutIntentSchema.safeParse(
      rawCheckoutIntentId
    );
    if (!parsedCheckoutIntent.success) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        message: parsedCheckoutIntent.error.issues
          .map((issue) => `Idempotency-Key: ${issue.message}`)
          .join("; "),
        details: {
          fields: [
            {
              field: "Idempotency-Key",
              code: parsedCheckoutIntent.error.issues[0]?.code,
            },
          ],
        },
      });
    }

    const result = await createCheckoutSession({
      orgUuid: ctx.orgUuid,
      userUuid: ctx.userUuid,
      productId,
      currency: body.currency ?? "usd",
      locale: body.locale,
      checkoutIntentId: parsedCheckoutIntent.data,
      requestId,
    });

    return respData(result);
  } catch (error) {
    // Never interpolate error.message into the response: Stripe payloads and
    // database query text belong only in the server log.
    return respError(error, {
      log: baseLogger,
      logFields: { event: "checkout.error" },
      fallback: "PAYMENT_SESSION_FAILED",
    });
  }
}
