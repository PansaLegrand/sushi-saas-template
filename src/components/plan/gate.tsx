"use client";

import type { ReactNode } from "react";

import { usePlan } from "@/providers/plan";
import type { PlanFeature } from "@/types/plan";

/**
 * Render `children` only when the current plan includes `feature`.
 *
 *     <Gate feature="tasks.text_to_video" fallback={<UpgradeNotice />}>
 *       <VideoStudio />
 *     </Gate>
 *
 * A rendering decision, never a security one. The server re-checks the same
 * entitlement in the route handler, and that is the check that matters — this
 * one only decides whether the user is shown a control they cannot use.
 *
 * While the plan is still loading, nothing is rendered: flashing the gated UI
 * and then retracting it reads as a bug, and flashing the upsell at a paying
 * customer reads as a worse one. Pass a server-rendered snapshot to
 * `PlanProvider` to skip that state entirely.
 */
export function Gate({
  feature,
  children,
  fallback = null,
  loadingFallback = null,
}: {
  feature: PlanFeature;
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}) {
  const { can, loading } = usePlan();

  if (loading) return <>{loadingFallback}</>;
  return <>{can(feature) ? children : fallback}</>;
}
