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

export default function PaymentFailed({
  invoiceNumber,
  amount,
  currency,
  manageUrl,
}: {
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  manageUrl?: string;
}) {
  const fmt = formatAmount(amount, currency);
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', lineHeight: 1.6, color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>We couldn’t process your payment</h1>
      <p style={{ margin: '0 0 8px' }}>
        {fmt ? `We attempted to charge ${fmt}` : 'We attempted to charge your card'} but it failed.
      </p>
      {invoiceNumber ? (
        <p style={{ margin: '0 0 8px' }}>Invoice: <strong>{invoiceNumber}</strong></p>
      ) : null}
      <p style={{ margin: '0 0 12px' }}>
        Please update your payment method to keep your subscription active.
      </p>
      {manageUrl ? (
        <p style={{ margin: 0 }}>
          <a href={manageUrl} style={{ color: '#2563eb' }}>Manage billing</a>
        </p>
      ) : (
        <p style={{ margin: 0 }}>Open your account billing page to manage payment methods.</p>
      )}
    </div>
  );
}

