import { ReservationsData } from "@/data/reservations";

export const ReservationsConfig = {
  // Toggle the entire feature on/off (kept as env for easy disabling)
  enabled:
    (process.env.NEXT_PUBLIC_FEATURE_RESERVATIONS_ENABLED ?? "true").toLowerCase() ===
    "true",
  // Auto-seed a demo service if none exist (env-controlled convenience)
  autoSeedDemo:
    (process.env.NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO ?? "true").toLowerCase() ===
    "true",
  // Code-level settings
  holdMinutes: ReservationsData.holdMinutes,
  horizonDays: ReservationsData.horizonDays,
  baseTimeZone: ReservationsData.baseTimeZone,
  businessHours: ReservationsData.businessHours,
};
