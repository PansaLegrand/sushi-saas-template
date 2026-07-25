"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getPlan } from "@/api/plan";
import type { LimitValue, PlanFeature, PlanLimit, PlanSnapshot, Tier } from "@/types/plan";

/**
 * Client-side access to the signed-in user's plan.
 *
 * The snapshot carries the resolved feature and limit maps rather than a tier
 * name, so the browser answers `can("storage.upload")` from the values the
 * server computed. A UI that reimplemented the rules would eventually disagree
 * with the server, and the disagreement always surfaces as a button that is
 * enabled right up until the request 403s.
 *
 * None of this is a security boundary. It decides what to *render*; the server
 * decides what is *allowed*, in `src/services/entitlements.ts`. Both read the
 * same catalog.
 *
 * Pass `snapshot` from a Server Component that already called
 * `getPlanSnapshot` — that renders gated UI correctly on the first paint.
 * Omit it and the provider fetches once on mount, which is the right trade
 * inside an already-client-rendered area.
 */

type PlanContextValue = {
  snapshot: PlanSnapshot | null;
  /** True until the first snapshot arrives. Always false when one was passed in. */
  loading: boolean;
  tier: Tier | null;
  can: (feature: PlanFeature) => boolean;
  limitOf: (limit: PlanLimit) => LimitValue;
};

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({
  children,
  snapshot: initialSnapshot,
}: {
  children: ReactNode;
  snapshot?: PlanSnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(
    initialSnapshot ?? null
  );
  const [loading, setLoading] = useState(initialSnapshot === undefined);

  useEffect(() => {
    // A snapshot was supplied — server-rendered, or explicitly null for a
    // signed-out area. Nothing to fetch.
    if (initialSnapshot !== undefined) {
      setSnapshot(initialSnapshot);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    getPlan(controller.signal)
      .then((next) => setSnapshot(next))
      // A signed-out visitor gets a 401 here. That is not an error worth
      // surfacing: it means "no plan", and gated UI should render its fallback.
      .catch(() => setSnapshot(null))
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [initialSnapshot]);

  const value = useMemo<PlanContextValue>(
    () => ({
      snapshot,
      loading,
      tier: snapshot?.tier ?? null,
      can: (feature) => snapshot?.features[feature] ?? false,
      limitOf: (limit) => snapshot?.limits[limit] ?? 0,
    }),
    [snapshot, loading]
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const context = useContext(PlanContext);
  if (context === undefined) {
    throw new Error("usePlan must be used within a PlanProvider");
  }
  return context;
}
