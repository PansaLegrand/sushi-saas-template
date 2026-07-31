"use client";

import { useCallback, useMemo, useState } from "react";

import { ExpirationPicker } from "@admin/components/expiration-picker";
import { getUserPlan, grantUserPlan, revokeUserPlan } from "@admin/lib/api";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/card";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { PlanSnapshot } from "@/types/plan";

interface Props {
  canWrite: boolean;
  /** Tier names from the catalog, resolved server-side. */
  tiers: Array<{ tier: string; name: string }>;
}

/**
 * Look up a user's plan, and comp them onto a tier.
 *
 * Comping is the only plan write an admin gets. Changing what someone *pays*
 * belongs in Stripe, where the proration, the invoice, and the receipt already
 * exist — reimplementing that here would produce a second, worse billing
 * system whose numbers disagree with the ones the customer was emailed.
 */
export default function ManagePlanPanel({ canWrite, tiers }: Props) {
  const [userUuid, setUserUuid] = useState("");
  const [tier, setTier] = useState(tiers.at(-1)?.tier ?? "");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);

  const disabled = useMemo(() => loading || !userUuid, [loading, userUuid]);

  const load = useCallback(async () => {
    if (!userUuid) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(await getUserPlan(userUuid));
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userUuid]);

  const grant = useCallback(async () => {
    if (!canWrite || !tier) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(
        await grantUserPlan({
          userUuid,
          tier,
          expiresAt,
          note: note.trim() || undefined,
        })
      );
      setNote("");
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [canWrite, tier, userUuid, expiresAt, note]);

  const revoke = useCallback(async () => {
    if (!canWrite) return;
    setLoading(true);
    setError(null);
    try {
      const result = await revokeUserPlan(userUuid);
      setPlan(result.plan);
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [canWrite, userUuid]);

  const subscription = plan?.subscription;
  const selectedTierName = tiers.find(
    (option) => option.tier === tier
  )?.name;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
        <Input
          aria-label="User UUID"
          placeholder="User UUID"
          value={userUuid}
          onChange={(e) => setUserUuid(e.currentTarget.value)}
        />
        <select
          aria-label="Tier"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={tier}
          onChange={(e) => setTier(e.currentTarget.value)}
        >
          {tiers.map((option) => (
            <option key={option.tier} value={option.tier}>
              {option.name}
            </option>
          ))}
        </select>
        <ExpirationPicker
          kind="plan"
          value={expiresAt}
          onChange={setExpiresAt}
          subject={
            selectedTierName
              ? `Complimentary ${selectedTierName} access`
              : "Complimentary access"
          }
          disabled={loading}
        />
      </div>

      <Input
        aria-label="Reason"
        placeholder="Reason (recorded in the audit log)"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />

      <div className="flex flex-wrap gap-3">
        <button
          className="inline-flex items-center rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => void load()}
          disabled={disabled}
        >
          {loading ? "Loading…" : "Load plan"}
        </button>
        <button
          className="inline-flex items-center rounded bg-secondary px-3 py-2 text-sm text-secondary-foreground disabled:opacity-50"
          onClick={() => void grant()}
          disabled={disabled || !canWrite}
          title={canWrite ? "Comp this user onto a tier" : "Read-only admin"}
        >
          {canWrite ? "Comp plan" : "Comp disabled (read-only)"}
        </button>
        <button
          className="inline-flex items-center rounded border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void revoke()}
          disabled={disabled || !canWrite}
          title="Ends comped access. Paid subscriptions are untouched."
        >
          Revoke comp
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {plan && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Tier" value={plan.name} />
            <StatCard label="Status" value={subscription?.status ?? "none"} />
            <StatCard label="Source" value={subscription?.source ?? "—"} />
            <StatCard
              label="Renews / ends"
              value={
                subscription?.currentPeriodEnd
                  ? subscription.currentPeriodEnd.slice(0, 10)
                  : "—"
              }
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Entitlement</th>
                  <th className="py-2 pr-4">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(plan.features).map(([key, value]) => (
                  <tr key={key} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">{key}</td>
                    <td className="py-2 pr-4">{value ? "yes" : "no"}</td>
                  </tr>
                ))}
                {Object.entries(plan.limits).map(([key, value]) => (
                  <tr key={key} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">{key}</td>
                    <td className="py-2 pr-4">{value === null ? "unlimited" : value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
