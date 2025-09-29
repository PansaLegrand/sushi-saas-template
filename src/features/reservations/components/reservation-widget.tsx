"use client";

import { useEffect, useMemo, useState } from "react";

type Service = {
  id: number;
  title: string;
  description?: string | null;
  duration_min: number;
  price: number;
  currency: string;
  deposit_amount: number;
  require_deposit: boolean;
};

export default function ReservationWidget({ services, locale }: { services: Service[]; locale: string }) {
  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const selectedService = useMemo(() => services.find((s) => s.id === serviceId) || null, [services, serviceId]);

  async function loadSlots() {
    if (!serviceId || !date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reservations/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId, date, timezone }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSlots(data.slots || []);
    } catch (e: any) {
      setError(e.message || "Failed to load availability");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Load initial slots for today
    loadSlots().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, date, timezone]);

  async function reserve(startISO: string) {
    if (!serviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: serviceId,
          start_at: startISO,
          timezone,
          contact_email: contactEmail || undefined,
          contact_phone: contactPhone || undefined,
          notes: notes || undefined,
          locale,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url as string;
      } else {
        setError("Checkout URL missing");
      }
    } catch (e: any) {
      setError(e.message || "Failed to create reservation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Service</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={serviceId ?? ""}
            onChange={(e) => setServiceId(Number(e.currentTarget.value) || null)}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} — {s.require_deposit ? `$${(s.deposit_amount / 100).toFixed(2)} deposit` : `$${(s.price / 100).toFixed(2)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Date</span>
          <input
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
        </label>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Timezone</span>
          <input
            type="text"
            className="w-full cursor-not-allowed rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
            value={timezone}
            onChange={(e) => setTimezone(e.currentTarget.value)}
            readOnly
          />
        </label>
        <div className="flex items-end">
          <button
            className="h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
            onClick={() => loadSlots()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh availability"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-medium">Available times</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {(slots ?? []).length === 0 && !loading ? (
            <p className="col-span-full text-sm text-muted-foreground">No slots available for this date.</p>
          ) : null}
          {(slots ?? []).map((iso) => {
            const d = new Date(iso);
            const label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return (
              <button
                key={iso}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => reserve(iso)}
                disabled={loading}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Contact email</span>
          <input
            type="email"
            placeholder="you@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Phone (optional)</span>
          <input
            type="tel"
            placeholder="(555) 123-4567"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.currentTarget.value)}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-2 block text-sm font-medium">Notes (optional)</span>
        <textarea
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </label>
    </div>
  );
}
