"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { resolveStripeEvent } from "@admin/lib/api";
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
    return <span className="text-xs text-muted-foreground">read-only</span>;
  }

  if (!open) {
    return (
      <button
        className="rounded border px-2 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        Resolve
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        aria-label={`Resolution note for ${eventId}`}
        placeholder="What was done, and where"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <p className="text-[11px] text-muted-foreground">
        Final. Stripe redeliveries of this event will be acknowledged without
        re-running it.
      </p>
      <div className="flex gap-2">
        <button
          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          onClick={() => void submit()}
          disabled={saving || !note.trim()}
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => {
            setOpen(false);
            setNote("");
            setError(null);
          }}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
