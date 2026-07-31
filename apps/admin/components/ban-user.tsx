"use client";

import { useCallback, useMemo, useState } from "react";

import { banUser, getUserBanState, unbanUser } from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/card";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { BanState, BlocklistEntry } from "@/types/moderation";

interface Props {
  canWrite: boolean;
}

type LoadedState = BanState & { blocklistEntries?: BlocklistEntry[] };

/**
 * Suspend an account, and lift a suspension.
 *
 * Not a delete, and the panel says so out loud. During an abuse wave the
 * instinct is to remove the account; removing it frees the address to register
 * again and throws away the signup IP and timestamps that identify the rest of
 * the wave.
 */
export default function BanUserPanel({ canWrite }: Props) {
  const [userUuid, setUserUuid] = useState("");
  const [reason, setReason] = useState("");
  const [blockEmail, setBlockEmail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadedState | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const disabled = useMemo(() => loading || !userUuid, [loading, userUuid]);

  const load = useCallback(async () => {
    if (!userUuid) return;
    setLoading(true);
    setError(null);
    setOutcome(null);
    try {
      setState(await getUserBanState(userUuid));
    } catch (e) {
      setState(null);
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userUuid]);

  const ban = useCallback(async () => {
    if (!canWrite) return;
    setLoading(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await banUser({
        userUuid,
        reason: reason.trim() || undefined,
        blockEmail,
      });

      const parts = [
        result.applied
          ? "Account suspended."
          : "Account was already suspended.",
        `${result.sessionsRevoked} session(s) revoked.`,
      ];
      // Surfaced rather than logged, because it is the part an admin does not
      // expect: one address can hold a password account and a Google account,
      // and closing only the one they pasted leaves the other open.
      if (result.alsoBanned.length > 0) {
        parts.push(
          `${result.alsoBanned.length} other account(s) on the same address also suspended.`,
        );
      }
      parts.push(
        result.blocklisted
          ? `Address blocked from registering again: ${result.blocklisted.value}`
          : "Address NOT blocked — they can register again through another provider.",
      );

      setOutcome(parts.join(" "));
      setState({
        ...result.state,
        blocklistEntries: result.blocklisted ? [result.blocklisted] : [],
      });
      setReason("");
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [canWrite, userUuid, reason, blockEmail]);

  const lift = useCallback(
    async (removeBlocklistEntry: boolean) => {
      if (!canWrite) return;
      setLoading(true);
      setError(null);
      setOutcome(null);
      try {
        const result = await unbanUser({ userUuid, removeBlocklistEntry });

        const parts = [
          result.applied ? "Suspension lifted." : "Account was not suspended.",
        ];
        if (result.alsoUnbanned.length > 0) {
          parts.push(
            `${result.alsoUnbanned.length} other account(s) on the same address also restored.`,
          );
        }
        if (result.remainingBlocklistEntries.length > 0) {
          parts.push(
            `Still blocked from registering by ${result.remainingBlocklistEntries.length} blocklist rule(s).`,
          );
        }

        setOutcome(parts.join(" "));
        setState({
          ...result.state,
          blocklistEntries: result.remainingBlocklistEntries,
        });
      } catch (e) {
        setError(resolveErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [canWrite, userUuid],
  );

  return (
    <div className="space-y-5" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <Field
          label="Suspension reason"
          description="This explanation is recorded in the audit log."
        >
          {(field) => (
            <Input
              {...field}
              placeholder="For example: repeated signup abuse"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm">
        {/* Native checkbox is intentional: the shared system has no checkbox
            primitive, and the platform control preserves keyboard semantics. */}
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 rounded border-input"
          checked={blockEmail}
          onChange={(e) => setBlockEmail(e.currentTarget.checked)}
        />
        <span>
          <span className="font-medium">
            Also block this email address from registering again
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            Leave this on for abuse. Without it the ban only closes the accounts
            that already exist — the same person can sign up again through a
            different provider on the same address, and the new account is not
            banned.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={disabled}
        >
          {loading ? "Loading…" : "Load status"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void ban()}
          disabled={disabled || !canWrite}
          title={
            canWrite
              ? "Blocks sign-in and revokes every live session"
              : "Read-only admin"
          }
        >
          {canWrite ? "Suspend account" : "Suspend disabled (read-only)"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void lift(false)}
          disabled={disabled || !canWrite}
          title="Restores sign-in. Any blocklist rule on the address stays."
        >
          Lift suspension
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void lift(true)}
          disabled={disabled || !canWrite}
          title="Restores sign-in and removes the address rule added by the ban."
        >
          Lift + unblock address
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {outcome ? (
        <Alert role="status">
          <AlertDescription>{outcome}</AlertDescription>
        </Alert>
      ) : null}

      {state && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Status"
              value={state.banned ? "Suspended" : "Active"}
            />
            <StatCard
              label="Since"
              value={state.bannedAt ? state.bannedAt.slice(0, 10) : "—"}
            />
            {/* Non-zero on a suspended account means revocation did not take —
                worth seeing rather than assuming. */}
            <StatCard label="Live sessions" value={state.activeSessions} />
            <StatCard
              label="Address blocked"
              value={(state.blocklistEntries?.length ?? 0) > 0 ? "Yes" : "No"}
            />
          </div>

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-mono text-sm">{state.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{state.reason || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Suspended by</dt>
              <dd className="font-mono text-sm">{state.bannedBy || "—"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
