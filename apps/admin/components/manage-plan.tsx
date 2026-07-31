"use client";

import { useCallback, useMemo, useState } from "react";

import { ExpirationPicker } from "@admin/components/expiration-picker";
import { getUserPlan, grantUserPlan, revokeUserPlan } from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        }),
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
  const selectedTierName = tiers.find((option) => option.tier === tier)?.name;

  return (
    <div className="space-y-5" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
        <Field label="User UUID" required>
          {(field) => (
            <Input
              {...field}
              aria-label="User UUID"
              placeholder="Paste a user UUID"
              value={userUuid}
              onChange={(e) => setUserUuid(e.currentTarget.value)}
              required
            />
          )}
        </Field>
        <Field label="Plan tier" required>
          {(field) => (
            <Select
              {...field}
              value={tier}
              onChange={(e) => setTier(e.currentTarget.value)}
              required
            >
              {tiers.map((option) => (
                <option key={option.tier} value={option.tier}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
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

      <Field
        label="Reason"
        description="Required context belongs in the audit log, not in a private note elsewhere."
      >
        {(field) => (
          <Input
            {...field}
            placeholder="Why is this access being changed?"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={disabled}
        >
          {loading ? "Loading…" : "Load plan"}
        </Button>
        <Button
          type="button"
          onClick={() => void grant()}
          disabled={disabled || !canWrite}
          title={canWrite ? "Comp this user onto a tier" : "Read-only admin"}
        >
          {canWrite ? "Comp plan" : "Comp disabled (read-only)"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void revoke()}
          disabled={disabled || !canWrite}
          title="Ends comped access. Paid subscriptions are untouched."
        >
          Revoke comp
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

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

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Entitlement</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(plan.features).map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono">{key}</TableCell>
                  <TableCell>{value ? "Yes" : "No"}</TableCell>
                </TableRow>
              ))}
              {Object.entries(plan.limits).map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono">{key}</TableCell>
                  <TableCell>{value === null ? "Unlimited" : value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
