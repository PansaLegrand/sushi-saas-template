import { NextRequest } from "next/server";
import { z } from "zod";

import { can, getOrgContext } from "@/services/authz";
import { findOrganizationByUuid } from "@/models/organization";
import { findUserByUuid } from "@/models/user";
import { getOrCreateCustomerIdForOrg } from "@/services/stripe";
import { createSafeBillingPortalSession } from "@/services/stripe/portal";
import { newStripeClient } from "@/integrations/stripe";
import { getAppEnv } from "@/lib/env";
import { absoluteLocaleUrl } from "@/i18n/locale";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";

export const runtime = "nodejs";

const BillingPortalSchema = z.object({
  locale: z.string().trim().optional(),
});

function withLocaleReturnUrl(
  locale: string | null | undefined,
  organizationSlug: string,
) {
  const base = getAppEnv().NEXT_PUBLIC_WEB_URL;
  const loc = locale && locale.length > 0 ? locale : "en";
  const url = new URL(absoluteLocaleUrl(base, loc, "/account/billing"));
  url.searchParams.set("org", organizationSlug);
  return url.toString();
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    // The portal exposes the payment method, invoices, and cancellation for
    // the whole team, so it is gated exactly like checkout.
    const ctx = await getOrgContext(req as unknown as Request);
    if (!ctx) return respCode("AUTH_REQUIRED");
    if (!can(ctx, "billing:manage")) return respCode("BILLING_OWNER_ONLY");

    const user = await findUserByUuid(ctx.userUuid);
    if (!user?.email) return respCode("ACCOUNT_NOT_FOUND");

    const org = await findOrganizationByUuid(ctx.orgUuid);
    if (!org) return respCode("RESOURCE_NOT_FOUND");

    const { searchParams } = new URL(req.url);
    const locale = searchParams.get("locale");
    const return_url = withLocaleReturnUrl(
      locale || user.locale || undefined,
      ctx.orgSlug,
    );

    const customerId = await getOrCreateCustomerIdForOrg({
      orgUuid: org.uuid,
      orgName: org.name,
      email: user.email,
      stripe_customer_id: org.stripe_customer_id,
    });

    const stripe = newStripeClient().stripe();
    const session = await createSafeBillingPortalSession(stripe, {
      customerId,
      returnUrl: return_url,
      configurationId: getAppEnv().STRIPE_BILLING_PORTAL_CONFIGURATION_ID!,
    });

    return Response.redirect(session.url, 302);
  } catch (error) {
    return respError(error, {
      logFields: { event: "billing.portal.create_failed" },
      fallback: "PAYMENT_SESSION_FAILED",
    });
  }
}

export async function POST(req: NextRequest) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    // The portal exposes the payment method, invoices, and cancellation for
    // the whole team, so it is gated exactly like checkout.
    const ctx = await getOrgContext(req as unknown as Request);
    if (!ctx) return respCode("AUTH_REQUIRED");
    if (!can(ctx, "billing:manage")) return respCode("BILLING_OWNER_ONLY");

    const user = await findUserByUuid(ctx.userUuid);
    if (!user?.email) return respCode("ACCOUNT_NOT_FOUND");

    const org = await findOrganizationByUuid(ctx.orgUuid);
    if (!org) return respCode("RESOURCE_NOT_FOUND");

    const body = await parseJsonBody(req, BillingPortalSchema, {
      defaultValue: {},
    });
    const locale = body?.locale ?? user.locale ?? "en";
    const return_url = withLocaleReturnUrl(locale, ctx.orgSlug);

    const customerId = await getOrCreateCustomerIdForOrg({
      orgUuid: org.uuid,
      orgName: org.name,
      email: user.email,
      stripe_customer_id: org.stripe_customer_id,
    });
    const stripe = newStripeClient().stripe();
    const session = await createSafeBillingPortalSession(stripe, {
      customerId,
      returnUrl: return_url,
      configurationId: getAppEnv().STRIPE_BILLING_PORTAL_CONFIGURATION_ID!,
    });
    return respData({ url: session.url });
  } catch (error) {
    return respError(error, {
      logFields: { event: "billing.portal.create_failed" },
      fallback: "PAYMENT_SESSION_FAILED",
    });
  }
}
