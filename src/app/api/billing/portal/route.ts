import { NextRequest } from "next/server";
import Stripe from "stripe";
import { getUserUuid } from "@/services/user";
import { findUserByUuid } from "@/models/user";
import { getOrCreateCustomerIdForUser } from "@/services/stripe-customer";
import { getAppEnv, getRequiredEnv } from "@/lib/env";

export const runtime = "nodejs";

function withLocaleReturnUrl(locale: string | null | undefined) {
  const base = getAppEnv().NEXT_PUBLIC_WEB_URL;
  const loc = locale && locale.length > 0 ? locale : "en";
  return `${base}/${loc}/account/billing`;
}

export async function GET(req: NextRequest) {
  try {
    const userUuid = await getUserUuid(req as any);
    if (!userUuid) return new Response("unauthorized", { status: 401 });
    const user = await findUserByUuid(userUuid);
    if (!user?.email) return new Response("invalid user", { status: 400 });

    const { searchParams } = new URL(req.url);
    const locale = searchParams.get("locale");
    const return_url = withLocaleReturnUrl(locale || user.locale || undefined);

    const customerId = await getOrCreateCustomerIdForUser({
      uuid: user.uuid,
      email: user.email,
      nickname: user.nickname || undefined,
      stripe_customer_id: (user as any).stripe_customer_id,
    });

    const stripe = new Stripe(getRequiredEnv("STRIPE_PRIVATE_KEY"));
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return Response.redirect(session.url, 302);
  } catch (e: any) {
    console.error("billing portal failed", e);
    return new Response("billing portal error", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userUuid = await getUserUuid(req as any);
    if (!userUuid) return new Response("unauthorized", { status: 401 });
    const user = await findUserByUuid(userUuid);
    if (!user?.email) return new Response("invalid user", { status: 400 });

    const body = await req.json().catch(() => ({}));
    const locale = body?.locale ?? user.locale ?? "en";
    const return_url = withLocaleReturnUrl(locale);

    const customerId = await getOrCreateCustomerIdForUser({
      uuid: user.uuid,
      email: user.email,
      nickname: user.nickname || undefined,
      stripe_customer_id: (user as any).stripe_customer_id,
    });
    const stripe = new Stripe(getRequiredEnv("STRIPE_PRIVATE_KEY"));
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("billing portal failed", e);
    return new Response(JSON.stringify({ error: "billing portal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
