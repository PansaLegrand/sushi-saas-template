import { createHash } from "node:crypto";
import type Stripe from "stripe";

import { ReservationsConfig } from "@/config/reservations";
import { absoluteLocaleUrl, normalizeLocale } from "@/i18n/locale";
import { newStripeClient } from "@/integrations/stripe";
import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { newId } from "@/lib/ids";
import {
  claimReservationCheckout,
  confirmReservationPayment,
  expireReservationCheckoutSession as expireReservationCheckoutSessionRow,
  expireReservationHold,
  ensureDemoService,
  getServiceById,
  hasConflict,
  listActiveServices,
  type Reservation,
  type ReservationOrder,
  type ReservationService,
} from "@/models/reservation";
import { updateOrderSession } from "@/models/order";
import { findUserByUuid } from "@/models/user";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { enqueueJob } from "@/services/jobs";
import { ActionRequiredError } from "@/services/stripe/action-required";

import { buildGoogleCalendarUrl } from "./google";
import { buildReservationICS } from "./ics";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_MIN_SESSION_LIFETIME_MS = 30 * 60 * 1000;

export type ReservationCheckoutResult = {
  checkout_url: string;
  reservation_no: string;
  order_no: string;
  session_id: string | null;
  reused: boolean;
};

/** List the catalog, optionally seeding the explicitly enabled local demo. */
export async function listReservationServices(): Promise<ReservationService[]> {
  if (ReservationsConfig.autoSeedDemo) {
    await ensureDemoService();
  }
  return listActiveServices();
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/**
 * Convert a wall-clock value in an IANA zone to its real UTC instant.
 *
 * `new Date(Date.UTC(...))` is not a timezone conversion: it treated 09:00 Los
 * Angeles as 09:00 UTC. Iterating the zone offset also lets us reject a local
 * time that does not exist across a daylight-saving transition.
 */
function zonedDateTime(
  target: Omit<LocalDateTime, "second">,
  timeZone: string,
): Date | null {
  const targetEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    0,
  );
  let candidateEpoch = targetEpoch;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = localParts(new Date(candidateEpoch), timeZone);
    const currentEpoch = Date.UTC(
      current.year,
      current.month - 1,
      current.day,
      current.hour,
      current.minute,
      0,
    );
    const correction = targetEpoch - currentEpoch;
    candidateEpoch += correction;
    if (correction === 0) break;
  }

  const candidate = new Date(candidateEpoch);
  const resolved = localParts(candidate, timeZone);
  if (
    resolved.year !== target.year ||
    resolved.month !== target.month ||
    resolved.day !== target.day ||
    resolved.hour !== target.hour ||
    resolved.minute !== target.minute
  ) {
    return null;
  }
  return candidate;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertPurchasableStart(
  start: Date,
  service: ReservationService,
  now: Date,
): void {
  const end = new Date(start.getTime() + service.duration_min * 60 * 1000);
  if (
    start.getTime() <= now.getTime() ||
    start.getTime() >
      now.getTime() + ReservationsConfig.horizonDays * 24 * 60 * 60 * 1000
  ) {
    throw new AppError("REQUEST_INVALID", {
      message: `reservation start is outside the purchase horizon: ${start.toISOString()}`,
      details: { field: "start_at" },
    });
  }

  const startLocal = localParts(start, ReservationsConfig.baseTimeZone);
  const endLocal = localParts(end, ReservationsConfig.baseTimeZone);
  const { startHour, endHour, slotMinutes } = ReservationsConfig.businessHours;
  const startMinute = startLocal.hour * 60 + startLocal.minute;
  const endMinute = endLocal.hour * 60 + endLocal.minute;
  const opensAt = startHour * 60;
  const closesAt = endHour * 60;

  if (
    startLocal.second !== 0 ||
    startMinute < opensAt ||
    endMinute > closesAt ||
    (startMinute - opensAt) % slotMinutes !== 0 ||
    startLocal.year !== endLocal.year ||
    startLocal.month !== endLocal.month ||
    startLocal.day !== endLocal.day
  ) {
    throw new AppError("REQUEST_INVALID", {
      message: `reservation start is outside configured business slots: ${start.toISOString()}`,
      details: { field: "start_at" },
    });
  }
}

function checkoutFingerprint(input: {
  service: ReservationService;
  start: Date;
  timezone: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  locale: string;
}): string {
  const { service } = input;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "reservation-checkout-v1",
        service.id,
        service.slug,
        service.duration_min,
        service.price,
        service.currency,
        service.deposit_amount,
        service.require_deposit,
        service.buffer_before_min,
        service.buffer_after_min,
        service.cancellation_window_hours,
        input.start.toISOString(),
        input.timezone,
        input.contactEmail,
        input.contactPhone,
        input.notes,
        input.locale,
      ]),
    )
    .digest("hex");
}

function successfulReservationUrl(
  reservation: Reservation,
  locale: string,
): string {
  return absoluteLocaleUrl(
    getAppEnv().NEXT_PUBLIC_WEB_URL,
    locale,
    `/reserve?reservation_no=${encodeURIComponent(
      reservation.reservation_no,
    )}&success=1`,
  );
}

function buildStripeOptions(input: {
  reservation: Reservation;
  order: ReservationOrder;
  locale: string;
}): Stripe.Checkout.SessionCreateParams {
  const { reservation, order, locale } = input;
  if (!reservation.hold_expires_at) {
    throw new AppError("RESERVATION_CREATE_FAILED", {
      message: `reservation ${reservation.reservation_no} has no hold expiry`,
    });
  }

  const metadata = {
    project: getAppEnv().NEXT_PUBLIC_PROJECT_NAME,
    type: "reservation",
    reservation_no: reservation.reservation_no,
    order_no: order.order_no,
    service_id: String(reservation.service_id),
    user_uuid: reservation.user_uuid,
    org_uuid: reservation.org_uuid,
    product_name: order.product_name || "Reservation",
    reservation_start_at: reservation.start_at.toISOString(),
    reservation_tz: reservation.timezone,
  };

  return {
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: order.currency || "usd",
          product_data: { name: order.product_name || "Reservation" },
          unit_amount: order.amount,
        },
        quantity: 1,
      },
    ],
    allow_promotion_codes: false,
    client_reference_id: order.order_no,
    metadata,
    payment_intent_data: { metadata },
    mode: "payment",
    success_url: successfulReservationUrl(reservation, locale),
    cancel_url: absoluteLocaleUrl(
      getAppEnv().NEXT_PUBLIC_WEB_URL,
      locale,
      "/reserve?canceled=1",
    ),
    customer_email: order.user_email,
    expires_at: Math.floor(reservation.hold_expires_at.getTime() / 1000),
  };
}

function existingSessionResult(
  reservation: Reservation,
  order: ReservationOrder,
  session: Stripe.Checkout.Session,
  locale: string,
): ReservationCheckoutResult {
  if (session.status === "expired") {
    throw new AppError("RESERVATION_HOLD_EXPIRED", {
      message: `reservation checkout session expired: ${session.id}`,
    });
  }
  if (
    session.status === "complete" ||
    reservation.status === "confirmed" ||
    order.status === "paid"
  ) {
    return {
      checkout_url: successfulReservationUrl(reservation, locale),
      reservation_no: reservation.reservation_no,
      order_no: order.order_no,
      session_id: session.id,
      reused: true,
    };
  }
  if (!session.url) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message: `reservation checkout session ${session.id} has no URL`,
    });
  }

  return {
    checkout_url: session.url,
    reservation_no: reservation.reservation_no,
    order_no: order.order_no,
    session_id: session.id,
    reused: true,
  };
}

// Generate availability slots for a given business date.
export async function getAvailabilityForDate(params: {
  service_id: number;
  dateISO: string;
  timezone: string;
}): Promise<string[]> {
  if (!validTimeZone(params.timezone)) return [];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.dateISO);
  if (!match) return [];

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarDate(year, month, day)) return [];

  const service = await getServiceById(params.service_id);
  if (!service?.active) return [];

  const now = Date.now();
  const horizon = now + ReservationsConfig.horizonDays * 24 * 60 * 60 * 1000;
  const { startHour, endHour, slotMinutes } = ReservationsConfig.businessHours;
  const slots: string[] = [];

  for (
    let minuteOfDay = startHour * 60;
    minuteOfDay < endHour * 60;
    minuteOfDay += slotMinutes
  ) {
    const start = zonedDateTime(
      {
        year,
        month,
        day,
        hour: Math.floor(minuteOfDay / 60),
        minute: minuteOfDay % 60,
      },
      ReservationsConfig.baseTimeZone,
    );
    if (!start || start.getTime() <= now || start.getTime() > horizon) continue;

    const end = new Date(start.getTime() + service.duration_min * 60 * 1000);
    const endLocal = localParts(end, ReservationsConfig.baseTimeZone);
    if (endLocal.hour * 60 + endLocal.minute > endHour * 60) continue;

    const conflict = await hasConflict({
      service_id: service.id,
      start_at: new Date(
        start.getTime() - service.buffer_before_min * 60 * 1000,
      ),
      end_at: new Date(end.getTime() + service.buffer_after_min * 60 * 1000),
    });
    if (!conflict) slots.push(start.toISOString());
  }

  return slots;
}

/**
 * Start or resume one reservation checkout intent.
 *
 * A new UUID is a deliberate new booking. Reusing a UUID resolves the same
 * database rows and the same Stripe idempotency key, including recovery after
 * Stripe succeeded but persisting its session id failed.
 */
export async function createReservationAndCheckout(params: {
  locale: string;
  org_uuid: string;
  user_uuid: string;
  service_id: number;
  start_at: string;
  timezone: string;
  checkout_intent_id: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
}): Promise<ReservationCheckoutResult> {
  const checkoutIntentId = params.checkout_intent_id.trim();
  if (!UUID_PATTERN.test(checkoutIntentId)) {
    throw new AppError("REQUEST_INVALID", {
      message: `invalid reservation checkout intent: ${checkoutIntentId}`,
      details: { field: "Idempotency-Key" },
    });
  }

  const timezone = params.timezone.trim();
  if (!validTimeZone(timezone)) {
    throw new AppError("REQUEST_INVALID", {
      message: `invalid reservation timezone: ${timezone}`,
      details: { field: "timezone" },
    });
  }

  const service = await getServiceById(params.service_id);
  if (!service) {
    throw new AppError("RESERVATION_NOT_FOUND", {
      message: `reservation service not found: ${params.service_id}`,
    });
  }
  if (!service.active) {
    throw new AppError("FEATURE_DISABLED", {
      message: `reservation service ${service.id} is inactive`,
    });
  }

  const start = new Date(params.start_at);
  if (Number.isNaN(start.getTime())) {
    throw new AppError("REQUEST_INVALID", {
      message: `invalid reservation start_at: ${params.start_at}`,
      details: { field: "start_at" },
    });
  }
  const now = new Date();
  assertPurchasableStart(start, service, now);

  const amountNow = service.require_deposit
    ? service.deposit_amount
    : service.price;
  if (!Number.isInteger(amountNow) || amountNow <= 0) {
    throw new AppError("RESERVATION_CREATE_FAILED", {
      message: `reservation service ${service.id} has invalid charge amount ${amountNow}`,
    });
  }

  const user = await findUserByUuid(params.user_uuid);
  if (!user?.email) {
    throw new AppError("ACCOUNT_NOT_FOUND", {
      message: `reservation user email not found: ${params.user_uuid}`,
    });
  }

  const locale = normalizeLocale(params.locale);
  const contactEmail = params.contact_email?.trim().toLowerCase() || "";
  const contactPhone = params.contact_phone?.trim() || "";
  const notes = params.notes?.trim() || "";
  const fingerprint = checkoutFingerprint({
    service,
    start,
    timezone,
    contactEmail,
    contactPhone,
    notes,
    locale,
  });
  const end = new Date(start.getTime() + service.duration_min * 60 * 1000);
  const holdExpiresAt = new Date(
    now.getTime() + ReservationsConfig.holdMinutes * 60 * 1000,
  );
  const reservationNo = newId();
  const orderNo = newId();

  let claim;
  try {
    claim = await claimReservationCheckout({
      now,
      reservation: {
        reservation_no: reservationNo,
        org_uuid: params.org_uuid,
        user_uuid: params.user_uuid,
        service_id: service.id,
        start_at: start,
        end_at: end,
        blocked_start_at: new Date(
          start.getTime() - service.buffer_before_min * 60 * 1000,
        ),
        blocked_end_at: new Date(
          end.getTime() + service.buffer_after_min * 60 * 1000,
        ),
        timezone,
        status: "pending",
        hold_expires_at: holdExpiresAt,
        order_no: orderNo,
        checkout_intent_id: checkoutIntentId,
        checkout_fingerprint: fingerprint,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
        notes: notes || undefined,
        policy_snapshot: JSON.stringify({
          cancellation_window_hours: service.cancellation_window_hours,
          require_deposit: service.require_deposit,
          deposit_amount: service.deposit_amount,
          price: service.price,
          currency: service.currency,
          buffer_before_min: service.buffer_before_min,
          buffer_after_min: service.buffer_after_min,
        }),
      },
      order: {
        order_no: orderNo,
        created_at: now,
        org_uuid: params.org_uuid,
        user_uuid: params.user_uuid,
        user_email: user.email,
        amount: amountNow,
        interval: "one-time",
        expired_at: null,
        status: "created",
        credits: 0,
        currency: service.currency,
        product_id: `reservation:${service.slug}`,
        product_name: `Reservation: ${service.title}`,
        valid_months: 0,
        checkout_intent_id: `reservation:${checkoutIntentId}`,
        checkout_fingerprint: fingerprint,
        checkout_locale: locale,
      },
    });
  } catch (error) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    };
    if (candidate.code === "23P01" || candidate.cause?.code === "23P01") {
      throw new AppError("RESERVATION_SLOT_UNAVAILABLE", {
        message: `database rejected an overlapping reservation for service ${service.id}`,
        cause: error,
      });
    }
    throw error;
  }

  if (claim.outcome === "conflict") {
    throw new AppError("RESERVATION_SLOT_UNAVAILABLE", {
      message: `reservation conflict for service ${service.id} at ${start.toISOString()}`,
    });
  }
  if (!claim.order) {
    throw new AppError("RESERVATION_CREATE_FAILED", {
      message: `reservation ${claim.reservation.reservation_no} has no order`,
    });
  }
  if (
    claim.reservation.checkout_fingerprint !== fingerprint ||
    claim.order.checkout_fingerprint !== fingerprint
  ) {
    throw new AppError("CHECKOUT_INTENT_CONFLICT", {
      message: `reservation intent ${checkoutIntentId} was reused with different terms`,
      details: { field: "Idempotency-Key" },
    });
  }

  const reservation = claim.reservation;
  const order = claim.order;
  const stableLocale = normalizeLocale(order.checkout_locale || locale);
  if (reservation.status === "confirmed" || order.status === "paid") {
    return {
      checkout_url: successfulReservationUrl(reservation, stableLocale),
      reservation_no: reservation.reservation_no,
      order_no: order.order_no,
      session_id: order.stripe_session_id,
      reused: true,
    };
  }
  if (reservation.status === "expired" || reservation.status === "canceled") {
    throw new AppError("RESERVATION_HOLD_EXPIRED", {
      message: `reservation hold expired: ${reservation.reservation_no}`,
    });
  }
  if (!reservation.hold_expires_at) {
    throw new AppError("RESERVATION_CREATE_FAILED", {
      message: `reservation ${reservation.reservation_no} has no hold expiry`,
    });
  }

  const stripe = newStripeClient().stripe();
  if (order.stripe_session_id) {
    let session = await stripe.checkout.sessions.retrieve(
      order.stripe_session_id,
    );
    if (
      session.status !== "expired" &&
      reservation.hold_expires_at.getTime() <= Date.now()
    ) {
      // Do not free a range while its known Checkout Session can still accept
      // payment. Expire the external session first, then release the row.
      session = await stripe.checkout.sessions.expire(session.id);
    }
    if (session.status === "expired") {
      await expireReservationCheckoutSessionRow({
        reservationNo: reservation.reservation_no,
        orderNo: order.order_no,
        stripeSessionId: session.id,
      });
    }
    return existingSessionResult(reservation, order, session, stableLocale);
  }

  if (reservation.hold_expires_at.getTime() <= Date.now()) {
    await expireReservationHold(reservation.reservation_no, new Date());
    throw new AppError("RESERVATION_HOLD_EXPIRED", {
      message: `reservation hold expired before Stripe session creation: ${reservation.reservation_no}`,
    });
  }

  // Stripe refuses a custom expiry less than 30 minutes in the future. A
  // replay that reaches this branch too late never created a usable external
  // session, so release the local hold and let the browser start a new intent.
  if (
    reservation.hold_expires_at.getTime() - Date.now() <
    STRIPE_MIN_SESSION_LIFETIME_MS
  ) {
    await expireReservationHold(reservation.reservation_no, new Date());
    throw new AppError("RESERVATION_HOLD_EXPIRED", {
      message: `reservation hold is too short to create Stripe session: ${reservation.reservation_no}`,
    });
  }

  const options = buildStripeOptions({
    reservation,
    order,
    locale: stableLocale,
  });
  const session = await stripe.checkout.sessions.create(options, {
    idempotencyKey: order.order_no,
  });
  const updated = await updateOrderSession(
    order.order_no,
    session.id,
    JSON.stringify(options),
  );
  if (!updated) {
    throw new AppError("RESERVATION_CREATE_FAILED", {
      message: `reservation order ${order.order_no} vanished before session update`,
    });
  }
  if (!session.url) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message: `new reservation checkout session ${session.id} has no URL`,
    });
  }

  return {
    checkout_url: session.url,
    reservation_no: reservation.reservation_no,
    order_no: order.order_no,
    session_id: session.id,
    reused: claim.outcome === "reused",
  };
}

/** Fulfill a paid reservation exactly once from a verified Stripe webhook. */
export async function fulfillReservationCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const reservationNo = session.metadata?.reservation_no;
  const orderNo = session.metadata?.order_no;
  if (!reservationNo || !orderNo) {
    throw new ActionRequiredError("reservation_checkout_missing_metadata", {
      stripe_session_id: session.id,
      reservation_no: reservationNo,
      order_no: orderNo,
    });
  }

  let result;
  try {
    result = await confirmReservationPayment({
      reservationNo,
      orderNo,
      stripeSessionId: session.id,
      paidAt: new Date(),
      paidEmail: session.customer_details?.email || "",
      paidDetail: JSON.stringify(session),
      amountPaid: session.amount_total,
      currency: session.currency,
    });
  } catch (error) {
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
    };
    if (candidate.code === "23P01" || candidate.cause?.code === "23P01") {
      throw new ActionRequiredError("reservation_paid_after_slot_reallocated", {
        stripe_session_id: session.id,
        reservation_no: reservationNo,
        order_no: orderNo,
      });
    }
    throw error;
  }
  if (result.outcome !== "confirmed" && result.outcome !== "replayed") {
    throw new ActionRequiredError(`reservation_checkout_${result.outcome}`, {
      stripe_session_id: session.id,
      reservation_no: reservationNo,
      order_no: orderNo,
    });
  }

  const to = session.customer_details?.email;
  await updateAffiliateForOrder({
    order_no: result.order.order_no,
    user_uuid: result.order.user_uuid,
    amount: result.order.amount,
  });
  if (!to) return;

  const { reservation, order } = result;
  const title = order.product_name || "Reservation";
  const start = reservation.start_at;
  const end = reservation.end_at;
  const locale = normalizeLocale(order.checkout_locale || "en");
  const ics = buildReservationICS({
    uid: reservationNo,
    start,
    end,
    title,
    description: `Reservation #${reservationNo} — ${title}`,
    url: absoluteLocaleUrl(
      getAppEnv().NEXT_PUBLIC_WEB_URL,
      locale,
      `/reserve?reservation_no=${encodeURIComponent(reservationNo)}`,
    ),
  });
  const googleUrl = buildGoogleCalendarUrl({
    title,
    start,
    end,
    description: `Reservation #${reservationNo}`,
    timeZone: ReservationsConfig.baseTimeZone,
  });
  await enqueueJob(
    "reservation_confirmed_email",
    {
      to,
      reservationNo,
      serviceTitle: title,
      startsAt: start.toISOString(),
      timezone: reservation.timezone,
      icsContent: ics,
      googleCalendarUrl: googleUrl,
    },
    {
      dedupeKey: `reservation_confirmed_email:${reservationNo}`,
      subjectUserUuid: reservation.user_uuid,
      subjectOrgUuid: reservation.org_uuid,
    },
  );
}

/** Release the exact reservation hold named by a terminal unpaid Stripe event. */
export async function expireReservationCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.metadata?.type !== "reservation") return;
  const reservationNo = session.metadata.reservation_no;
  const orderNo = session.metadata.order_no;
  if (!reservationNo || !orderNo) {
    throw new ActionRequiredError("reservation_expiry_missing_metadata", {
      stripe_session_id: session.id,
      reservation_no: reservationNo,
      order_no: orderNo,
    });
  }

  const result = await expireReservationCheckoutSessionRow({
    reservationNo,
    orderNo,
    stripeSessionId: session.id,
  });
  if (
    result.outcome === "not_found" ||
    result.outcome === "order_mismatch" ||
    result.outcome === "session_mismatch"
  ) {
    throw new ActionRequiredError(`reservation_expiry_${result.outcome}`, {
      stripe_session_id: session.id,
      reservation_no: reservationNo,
      order_no: orderNo,
    });
  }
}
