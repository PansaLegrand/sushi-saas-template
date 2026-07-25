import { isReservationDemoAutoSeedEnabled } from "@/lib/demo-flags";

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


// Runtime feature configuration. Combines the static values above with the two
// env switches that gate the feature, so callers have a single import rather
// than reaching for `process.env` themselves.
export const ReservationsConfig = {
  // Toggle the entire feature on/off (kept as env for easy disabling)
  enabled:
    (process.env.NEXT_PUBLIC_FEATURE_RESERVATIONS_ENABLED ?? "true").toLowerCase() ===
    "true",
  // Auto-seed a demo service if none exist (env-controlled convenience)
  autoSeedDemo: isReservationDemoAutoSeedEnabled(),
  // Code-level settings
  holdMinutes: ReservationsData.holdMinutes,
  horizonDays: ReservationsData.horizonDays,
  baseTimeZone: ReservationsData.baseTimeZone,
  businessHours: ReservationsData.businessHours,
};
