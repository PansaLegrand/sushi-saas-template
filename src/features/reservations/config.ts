import { ReservationsData } from "@/data/reservations";
import { isReservationDemoAutoSeedEnabled } from "@/lib/demo-flags";

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
