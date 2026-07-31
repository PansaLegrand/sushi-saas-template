"use client";

import { useMemo, useState } from "react";

import { ExpirationPicker } from "@admin/components/expiration-picker";
import {
  resetOrganizationSeatLimit,
  setOrganizationSeatLimit,
} from "@admin/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { OrganizationSeatSummary } from "@/types/team";

export function ManageOrganizationSeats({
  orgUuid,
  canWrite,
  initial,
}: {
  orgUuid: string;
  canWrite: boolean;
  initial: OrganizationSeatSummary;
}) {
  const [summary, setSummary] = useState(initial);
  const [limit, setLimit] = useState(
    String(initial.override?.limit ?? initial.effectiveLimit ?? ""),
  );
  const [expiresAt, setExpiresAt] = useState<string | null>(
    initial.override?.expiresAt ?? null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedLimit = Number(limit);
  const canSubmit = useMemo(
    () =>
      canWrite &&
      !busy &&
      Number.isSafeInteger(parsedLimit) &&
      parsedLimit >= 1 &&
      note.trim().length >= 3,
    [busy, canWrite, note, parsedLimit],
  );

  const save = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setOrganizationSeatLimit({
        orgUuid,
        limit: parsedLimit,
        expiresAt,
        note: note.trim(),
      });
      setSummary(next);
      setNote("");
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!canWrite || busy || note.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const next = await resetOrganizationSeatLimit({
        orgUuid,
        note: note.trim(),
      });
      setSummary(next);
      setLimit(String(next.effectiveLimit ?? ""));
      setExpiresAt(null);
      setNote("");
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const effective = summary.effectiveLimit ?? "Unlimited";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization seats</CardTitle>
        <CardDescription>
          The plan supplies the default. An override changes capacity without
          changing billing or removing existing members.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Plan limit", summary.planLimit ?? "Unlimited"],
            ["Effective limit", effective],
            ["Members", summary.members],
            ["Pending invitations", summary.pendingInvitations],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border bg-muted/30 p-4"
            >
              <dt className="text-sm font-medium text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-2 text-2xl font-semibold tracking-tight">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {summary.overLimit ? (
          <Alert variant="warning">
            <AlertTitle>Organization is over its current limit</AlertTitle>
            <AlertDescription>
              Existing members keep access and new invitations are blocked. Some
              pending invitations may no longer be accepted unless usage falls
              or the limit increases above {effective}.
            </AlertDescription>
          </Alert>
        ) : null}

        {summary.override && !summary.override.active ? (
          <Alert variant="warning">
            <AlertTitle>Override expired</AlertTitle>
            <AlertDescription>
              The plan limit is active. Save a new exception or reset the
              expired value to remove it from the organization record.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          <Field
            label="Seat limit override"
            description="Includes owners, admins, members, and pending invitations."
            required
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={100000}
                step={1}
                value={limit}
                onChange={(event) => setLimit(event.currentTarget.value)}
                disabled={!canWrite || busy}
                required
              />
            )}
          </Field>

          <ExpirationPicker
            kind="seats"
            value={expiresAt}
            onChange={setExpiresAt}
            subject="This seat-limit exception"
            disabled={!canWrite || busy}
          />

          <Field
            label="Reason"
            description="Required and recorded in the append-only admin audit log."
            required
          >
            {(field) => (
              <Input
                {...field}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                disabled={!canWrite || busy}
                placeholder="VIP agreement, support exception…"
                required
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!canSubmit}
          >
            {busy ? "Saving…" : "Save override"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void reset()}
            disabled={
              !canWrite || busy || !summary.override || note.trim().length < 3
            }
          >
            Reset to plan limit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
