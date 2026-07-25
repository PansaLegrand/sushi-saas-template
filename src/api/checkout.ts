import { api } from "@/lib/api/client";

export function createCheckout(input: {
  product_id: string;
  currency: string;
  locale: string;
}) {
  return api.post<{ checkout_url?: string }>("/api/checkout", { body: input });
}
