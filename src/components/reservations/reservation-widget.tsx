"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

export default function ReservationWidget({
  services,
  locale,
}: {
  services: ReservationService[];
  locale: string;
}) {
  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [timezone] = useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId]
  );

  const loadSlots = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceId || !date) return;
      setLoading(true);
      setError(null);
      try {
        // `getAvailability` unwraps the `{ code, message, data }` envelope. The
        // hand-rolled version this replaced read `slots` off the envelope
        // itself, where it never existed, so the grid was always empty.
        const data = await getAvailability(
          { service_id: serviceId, date, timezone },
          signal
        );
        setSlots(data?.slots ?? []);
      } catch (err) {
        setError(resolveErrorMessage(err, locale, "RESERVATION_AVAILABILITY_FAILED"));
        setSlots([]);
      } finally {
        setLoading(false);
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
    if (!serviceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await createReservation({
        service_id: serviceId,
        start_at: startISO,
        timezone,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
        notes: notes || undefined,
        locale,
      });

      if (!data?.checkout_url) throw new Error("PAYMENT_SESSION_FAILED");
      window.location.href = data.checkout_url;
    } catch (err) {
      setError(resolveErrorMessage(err, locale, "RESERVATION_CREATE_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field label="Service">
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
                    ? `$${(s.deposit_amount / 100).toFixed(2)} deposit`
                    : `$${(s.price / 100).toFixed(2)}`}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Date">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field label="Timezone" description="Detected from your browser.">
          {(field) => (
            <Input {...field} value={timezone} readOnly className="bg-muted/50" />
          )}
        </Field>
        <div className="flex items-end">
          <Button variant="secondary" onClick={() => void loadSlots()} disabled={loading}>
            {loading ? "Loading…" : "Refresh availability"}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-medium">
          Available times
          {selectedService ? ` · ${selectedService.duration_min} min` : null}
        </h3>

        {loading && slots === null ? (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
            aria-busy="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (slots ?? []).length === 0 ? (
          <EmptyState
            title="No slots available"
            description="Try another date, or refresh availability."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {(slots ?? []).map((iso) => {
              const label = new Date(iso).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <Button
                  key={iso}
                  variant="outline"
                  onClick={() => void reserve(iso)}
                  disabled={loading}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Contact email">
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
        <Field label="Phone" description="Optional.">
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

      <Field label="Notes" description="Optional." className="mt-3">
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
