import { api } from "@/lib/api/client";

export interface ReservationService {
  id: number;
  title: string;
  description?: string | null;
  duration_min: number;
  price: number;
  currency: string;
  deposit_amount: number;
  require_deposit: boolean;
}

export interface CreateReservationInput {
  service_id: number;
  start_at: string;
  timezone: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
  locale: string;
}

export function getAvailability(
  input: { service_id: number; date: string; timezone: string },
  signal?: AbortSignal
) {
  return api.post<{ slots: string[] }>("/api/reservations/availability", {
    body: input,
    signal,
  });
}

export function createReservation(input: CreateReservationInput) {
  return api.post<{ checkout_url?: string }>("/api/reservations", { body: input });
}
