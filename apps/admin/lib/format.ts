const ADMIN_DATE_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatAdminDate(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return `${ADMIN_DATE_FORMAT.format(date)} UTC`;
}

export function formatAdminMoney(
  amount: number,
  currency: string | null | undefined = "usd",
): string {
  const normalizedCurrency = (currency || "usd").toUpperCase();

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}
