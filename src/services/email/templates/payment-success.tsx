import * as React from "react";

function formatAmount(amount?: number, currency?: string) {
  if (typeof amount !== "number") return undefined;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}

export default function PaymentSuccess({
  orderNo,
  amount,
  currency,
}: {
  orderNo?: string;
  amount?: number;
  currency?: string;
}) {
  const fmt = formatAmount(amount, currency);
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', lineHeight: 1.6, color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>Payment received</h1>
      <p style={{ margin: '0 0 8px' }}>
        Thank you for your purchase!{fmt ? ` We received ${fmt}.` : ''}
      </p>
      {orderNo ? (
        <p style={{ margin: '0 0 8px' }}>Order: <strong>{orderNo}</strong></p>
      ) : null}
      <p style={{ margin: 0 }}>If you have any questions, just reply to this email.</p>
    </div>
  );
}

