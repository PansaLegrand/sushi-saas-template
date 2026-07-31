"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { resolveStripeEvent } from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resolveErrorMessage } from "@/lib/errors/client";

interface Props {
  eventId: string;
  canWrite: boolean;
}

/**
 * Close one parked event.
 *
 * Two-step on purpose, and not because the action is dangerous — it writes no
 * money. It is because resolving is *final*: a later Stripe redelivery is
 * acknowledged and not re-run, so this is the last thing that will ever happen
 * to the row. A single button next to fifty others is how that gets clicked on
 * the wrong line.
 */
export default function ResolveStripeEvent({ eventId, canWrite }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!canWrite || !note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await resolveStripeEvent({ eventId, note: note.trim() });
      setOpen(false);
      setNote("");
      // The row's status is server-rendered, so re-fetch rather than patching
      // it locally: a refresh cannot disagree with the database about whether
      // the resolve landed.
      router.refresh();
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [canWrite, eventId, note, router]);

  if (!canWrite) {
    return <span className="text-sm text-muted-foreground">Read-only</span>;
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Resolve
      </Button>
    );
  }

  return (
    <div className="w-80 space-y-3">
      <Field label="Resolution note" required>
        {(field) => (
          <Input
            {...field}
            aria-label={`Resolution note for ${eventId}`}
            placeholder="What was done, and where?"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            required
          />
        )}
      </Field>
      <Alert variant="warning" role="status">
        <AlertDescription>
          This is final. Stripe redeliveries will be acknowledged without
          re-running this event.
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={saving || !note.trim()}
        >
          {saving ? "Saving…" : "Confirm resolution"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setNote("");
            setError(null);
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
