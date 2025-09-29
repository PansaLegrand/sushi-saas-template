// Centralized configuration for the Reservations demo feature.
// Keep these values in code so the feature remains portable and easy to tweak.

export const ReservationsData = {
  // Base timezone for business-hours scheduling (IANA name)
  baseTimeZone: "America/Los_Angeles",

  // How long a pending reservation remains on hold before payment completes (minutes)
  holdMinutes: 15,

  // Availability window into the future (days)
  horizonDays: 14,

  // Business hours used to generate slots (local to baseTimeZone)
  businessHours: {
    startHour: 9,
    endHour: 17,
    slotMinutes: 30,
  },
} as const;

export type ReservationsDataType = typeof ReservationsData;

