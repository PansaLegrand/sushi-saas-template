"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  createReservation,
  getAvailability,
  type ReservationService,
} from "@/api/reservations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { resolveErrorMessage } from "@/lib/errors/client";

function localDateInputValue(date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export default function ReservationWidget({
  services,
  locale,
}: {
  services: ReservationService[];
  locale: string;
}) {
  const t = useTranslations("reservation");
  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [today] = useState(() => localDateInputValue());
  const [date, setDate] = useState<string>(today);
  const [timezone] = useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [slots, setSlots] = useState<string[] | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  // React state is not synchronous: two click events can enter `reserve`
  // before `disabled={loading}` reaches the DOM. The ref closes that gap, and
  // the retained intent repairs a failed request instead of creating another
  // hold/order on retry.
  const reservationInFlightRef = useRef(false);
  const checkoutIntentRef = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const availabilityRequestRef = useRef(0);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId]
  );

  const loadSlots = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceId || !date) return;
      const requestId = ++availabilityRequestRef.current;
      setAvailabilityStatus("loading");
      setAvailabilityError(null);
      setSlots(null);
      try {
        // `getAvailability` unwraps the `{ code, message, data }` envelope. The
        // hand-rolled version this replaced read `slots` off the envelope
        // itself, where it never existed, so the grid was always empty.
        const data = await getAvailability(
          { service_id: serviceId, date, timezone },
          signal
        );
        if (signal?.aborted || requestId !== availabilityRequestRef.current) {
          return;
        }
        setSlots(data?.slots ?? []);
        setAvailabilityStatus("ready");
      } catch (err) {
        if (signal?.aborted || requestId !== availabilityRequestRef.current) {
          return;
        }
        setAvailabilityError(
          resolveErrorMessage(
            err,
            locale,
            "RESERVATION_AVAILABILITY_FAILED",
          ),
        );
        setSlots([]);
        setAvailabilityStatus("error");
      }
    },
    [serviceId, date, timezone, locale]
  );

  useEffect(() => {
    // Aborts the in-flight request when the user changes service or date again
    // before it resolves, so a slow earlier response cannot overwrite a newer one.
    const controller = new AbortController();
    void loadSlots(controller.signal);
    return () => controller.abort();
  }, [loadSlots]);

  async function reserve(startISO: string) {
    if (!serviceId || reservationInFlightRef.current) return;
    reservationInFlightRef.current = true;
    setReserving(true);
    setReservationError(null);
    const input = {
      service_id: serviceId,
      start_at: startISO,
      timezone,
      contact_email: contactEmail || undefined,
      contact_phone: contactPhone || undefined,
      notes: notes || undefined,
      locale,
    };
    const fingerprint = JSON.stringify(input);
    if (checkoutIntentRef.current?.fingerprint !== fingerprint) {
      checkoutIntentRef.current = {
        fingerprint,
        id: crypto.randomUUID(),
      };
    }

    try {
      const data = await createReservation(
        input,
        checkoutIntentRef.current.id
      );

      if (!data?.checkout_url) throw new Error("PAYMENT_SESSION_FAILED");
      // Do not rotate here. A successful navigation destroys this component;
      // if the browser blocks the assignment, another click must still resolve
      // the same checkout rather than reserve a second slot.
      window.location.href = data.checkout_url;
    } catch (err) {
      setReservationError(
        resolveErrorMessage(err, locale, "RESERVATION_CREATE_FAILED"),
      );
    } finally {
      reservationInFlightRef.current = false;
      setReserving(false);
    }
  }

  if (services.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4">
        <EmptyState
          title={t("noServicesTitle")}
          description={t("noServicesDescription")}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field label={t("serviceLabel")}>
          {(field) => (
            <Select
              {...field}
              value={serviceId ?? ""}
              onChange={(e) => setServiceId(Number(e.currentTarget.value) || null)}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} —{" "}
                  {s.require_deposit
                    ? t("depositPrice", {
                        price: formatMoney(
                          s.deposit_amount,
                          s.currency,
                          locale,
                        ),
                      })
                    : formatMoney(s.price, s.currency, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t("dateLabel")}>
          {(field) => (
            <Input
              {...field}
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field
          label={t("timezoneLabel")}
          description={t("timezoneDescription")}
        >
          {(field) => (
            <Input {...field} value={timezone} readOnly className="bg-muted/50" />
          )}
        </Field>
        <div className="flex items-end">
          <Button
            variant="secondary"
            onClick={() => void loadSlots()}
            disabled={availabilityStatus === "loading" || reserving}
          >
            {availabilityStatus === "loading"
              ? t("loading")
              : t("refreshAvailability")}
          </Button>
        </div>
      </div>

      {availabilityError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{availabilityError}</AlertDescription>
        </Alert>
      ) : null}

      {reservationError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{reservationError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-medium">
          {t("availableTimes")}
          {selectedService
            ? ` · ${t("minutes", { value: selectedService.duration_min })}`
            : null}
        </h3>

        {availabilityStatus === "loading" ? (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            aria-busy="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : availabilityStatus === "error" ? null : (slots ?? []).length === 0 ? (
          <EmptyState
            title={t("noSlotsTitle")}
            description={t("noSlotsDescription")}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {(slots ?? []).map((iso) => {
              const label = new Date(iso).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <Button
                  key={iso}
                  variant="outline"
                  onClick={() => void reserve(iso)}
                  disabled={reserving}
                  aria-busy={reserving}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("contactEmail")}>
          {(field) => (
            <Input
              {...field}
              type="email"
              placeholder="you@example.com"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={t("phone")} description={t("optional")}>
          {(field) => (
            <Input
              {...field}
              type="tel"
              placeholder="(555) 123-4567"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <Field label={t("notes")} description={t("optional")} className="mt-3">
        {(field) => (
          <Textarea
            {...field}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
        )}
      </Field>
    </div>
  );
}
