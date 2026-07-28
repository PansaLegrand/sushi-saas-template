import { api } from "@/lib/api/client";

export function createCheckout(input: {
  product_id: string;
  currency: string;
  locale: string;
}, checkoutIntentId: string) {
  return api.post<{
    order_no: string;
    session_id: string | null;
    checkout_url: string;
    reused: boolean;
  }>("/api/checkout", {
    headers: { "Idempotency-Key": checkoutIntentId },
    body: input,
  });
}
