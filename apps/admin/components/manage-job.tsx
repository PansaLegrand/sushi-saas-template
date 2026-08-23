"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateJob } from "@admin/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { resolveErrorMessage } from "@/lib/errors/client";

export function ManageJob({
  uuid,
  action,
}: {
  uuid: string;
  action: "retry" | "cancel";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retrying = action === "retry";

  async function submit() {
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateJob({ uuid, action, note: note.trim() });
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        setOpen(next);
        if (!next) {
          setNote("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={retrying ? "outline" : "destructive"}
        >
          {retrying ? "Retry" : "Cancel"}
        </Button>
      </DialogTrigger>
      <DialogContent hideCloseButton>
        <DialogHeader>
          <DialogTitle>{retrying ? "Retry job" : "Cancel job"}</DialogTitle>
          <DialogDescription>
            {retrying
              ? "This resets the attempt count and schedules the failed job immediately."
              : "Only unclaimed pending work can be canceled. Running work cannot be recalled."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="break-all font-mono text-sm text-muted-foreground">
            {uuid}
          </p>
          <Field label="Operator note" required>
            {(field) => (
              <Textarea
                {...field}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                placeholder="Why is this action needed?"
                maxLength={2000}
                required
              />
            )}
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={saving}>
              Keep job
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={retrying ? "default" : "destructive"}
            disabled={saving || !note.trim()}
            onClick={() => void submit()}
          >
            {saving
              ? retrying
                ? "Retrying…"
                : "Canceling…"
              : retrying
                ? "Confirm retry"
                : "Confirm cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
