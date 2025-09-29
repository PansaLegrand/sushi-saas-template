import Stripe from "stripe";
import { ReservationsConfig } from "./config";
import {
  ensureDemoService,
  getServiceById,
  hasConflict,
  createReservation,
  attachOrderToReservation,
  type Reservation,
  type ReservationService,
} from "./models";
import { newStripeClient } from "@/integrations/stripe";
import { getSnowId } from "@/lib/hash";
import { insertOrder, OrderStatus, updateOrderSession } from "@/models/order";
import { findUserByUuid } from "@/models/user";

// Generate availability slots for a given date in the user's timezone.
export async function getAvailabilityForDate(params: {
  service_id: number;
  dateISO: string; // YYYY-MM-DD selected by user
  timezone: string; // user's timezone (used for client display; schedule uses baseTimeZone)
}): Promise<string[]> {
  const svc = await getServiceById(params.service_id);
  if (!svc || !svc.active) return [];

  // Build time window for the date in the given timezone
  const { startHour, endHour, slotMinutes } = ReservationsConfig.businessHours;
  const baseTz = ReservationsConfig.baseTimeZone;

  // Helper to create an ISO for a y-m-d hh:mm time in a target time zone
  function toZonedISO(y: number, m: number, d: number, hh: number, mm: number, timeZone: string) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(Date.UTC(y, m - 1, d, hh, mm)));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const yr = get("year");
    const mo = get("month");
    const da = get("day");
    const hr = get("hour");
    const mi = get("minute");
    const local = new Date(Date.UTC(yr, mo - 1, da, hr, mi));
    return local.toISOString();
  }

  // Interpret the requested date in the base timezone (business hours tz)
  const y = Number(params.dateISO.slice(0, 4));
  const m = Number(params.dateISO.slice(5, 7));
  const d = Number(params.dateISO.slice(8, 10));

  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let minute = 0; minute < 60; minute += slotMinutes) {
      const startISO = toZonedISO(y, m, d, h, minute, baseTz);
      const start = new Date(startISO);
      const end = new Date(start.getTime() + svc.duration_min * 60 * 1000);

      // Skip past slots
      if (start.getTime() < Date.now()) continue;

      // Check for conflicts
      // Add buffers if needed
      const startWithBuffer = new Date(
        start.getTime() - svc.buffer_before_min * 60 * 1000
      );
      const endWithBuffer = new Date(
        end.getTime() + svc.buffer_after_min * 60 * 1000
      );

      const conflict = await hasConflict({
        service_id: svc.id,
        start_at: startWithBuffer,
        end_at: endWithBuffer,
      });
      if (!conflict) slots.push(startISO);
    }
  }

  return slots;
}

export async function createReservationAndCheckout(params: {
  locale: string;
  user_uuid: string;
  service_id: number;
  start_at: string; // ISO
  timezone: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
}): Promise<{ checkout_url: string; reservation_no: string; order_no: string }> {
  let svc = await getServiceById(params.service_id);
  if (!svc) {
    // As a convenience for the demo, auto-seed a service if missing
    svc = await ensureDemoService();
  }
  if (!svc.active) throw new Error("service not available");

  const start = new Date(params.start_at);
  const end = new Date(start.getTime() + svc.duration_min * 60 * 1000);

  const conflict = await hasConflict({
    service_id: svc.id,
    start_at: new Date(start.getTime() - svc.buffer_before_min * 60 * 1000),
    end_at: new Date(end.getTime() + svc.buffer_after_min * 60 * 1000),
  });
  if (conflict) throw new Error("time slot unavailable");

  const reservation = await createReservation({
    user_uuid: params.user_uuid,
    service_id: svc.id,
    start_at: start,
    end_at: end,
    timezone: params.timezone,
    contact_email: params.contact_email,
    contact_phone: params.contact_phone,
    notes: params.notes,
    policy_snapshot: JSON.stringify({
      cancellation_window_hours: svc.cancellation_window_hours,
      require_deposit: svc.require_deposit,
      deposit_amount: svc.deposit_amount,
      price: svc.price,
      currency: svc.currency,
    }),
  });

  // Compute amount to charge now
  const amountNow = svc.require_deposit
    ? Math.max(0, svc.deposit_amount)
    : Math.max(0, svc.price);

  // Create a lightweight order for bookkeeping and emails
  const user = await findUserByUuid(params.user_uuid);
  if (!user?.email)
    throw new Error("user email not found");

  const order_no = String(getSnowId());
  await insertOrder({
    order_no,
    created_at: new Date(),
    user_uuid: params.user_uuid,
    user_email: user.email,
    amount: amountNow,
    interval: "one-time",
    expired_at: null,
    status: OrderStatus.Created,
    credits: 0,
    currency: svc.currency,
    product_id: `reservation:${svc.slug}`,
    product_name: `Reservation: ${svc.title}`,
    valid_months: 0,
  });

  await attachOrderToReservation(reservation.reservation_no, order_no);

  // Build Stripe Checkout
  const client = newStripeClient();
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  const successUrl = `${webUrl}/${params.locale}/reserve?reservation_no=${encodeURIComponent(
    reservation.reservation_no
  )}&success=1`;
  const cancelUrl = `${webUrl}/${params.locale}/reserve?canceled=1`;

  const options: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: svc.currency,
          product_data: {
            name: `Reservation: ${svc.title}`,
          },
          unit_amount: amountNow,
        },
        quantity: 1,
      },
    ],
    allow_promotion_codes: false,
    metadata: {
      project: process.env.NEXT_PUBLIC_PROJECT_NAME || "",
      type: "reservation",
      reservation_no: reservation.reservation_no,
      order_no,
      service_id: String(svc.id),
      user_uuid: params.user_uuid,
      product_name: `Reservation: ${svc.title}`,
      reservation_start_at: start.toISOString(),
      reservation_tz: params.timezone,
    },
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: user.email || undefined,
  };

  if (svc.currency === "cny") {
    options.payment_method_types = ["wechat_pay", "alipay", "card"] as any;
    options.payment_method_options = {
      wechat_pay: { client: "web" },
      alipay: {},
    } as any;
  }

  const session = await client.stripe().checkout.sessions.create(options);

  // update order detail
  await updateOrderSession(order_no, session.id, JSON.stringify(options));

  return {
    checkout_url: session.url!,
    reservation_no: reservation.reservation_no,
    order_no,
  };
}
