import { NextRequest } from "next/server";
import Stripe from "stripe";
import { getUserUuid } from "@/services/user";
import { findUserByUuid } from "@/models/user";
import { getOrCreateCustomerIdForUser } from "@/services/stripe-customer";

export const runtime = "nodejs";

function withLocaleReturnUrl(locale: string | null | undefined) {
  const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
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

    const key = process.env.STRIPE_PRIVATE_KEY;
    if (!key) throw new Error("STRIPE_PRIVATE_KEY not configured");
    const stripe = new Stripe(key);
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
    const key = process.env.STRIPE_PRIVATE_KEY;
    if (!key) throw new Error("STRIPE_PRIVATE_KEY not configured");
    const stripe = new Stripe(key);
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
