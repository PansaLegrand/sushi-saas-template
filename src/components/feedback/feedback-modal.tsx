"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { submitFeedback } from "@/api/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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

export default function FeedbackModal() {
  const t = useTranslations("feedback");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState("");
  const [rating, setRating] = useState<number | null>(null);

  const reset = () => {
    setContent("");
    setRating(null);
  };

  const onSubmit = async () => {
    if (content.trim().length < 3) {
      toast.error(t("errorTooShort"));
      return;
    }

    try {
      setSubmitting(true);
      await submitFeedback({
        content: content.trim(),
        rating: rating ?? undefined,
      });
      toast.success(t("submitSuccess"));
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(resolveErrorMessage(error, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      // Radix routes Escape, overlay clicks, and the close button all through
      // here, so one guard keeps every one of them from interrupting a submit.
      onOpenChange={(next) => {
        if (submitting) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">{t("buttonLabel")}</Button>
      </DialogTrigger>

      <DialogContent closeLabel={t("cancel")}>
        <DialogHeader>
          <DialogTitle>{t("modalTitle")}</DialogTitle>
          <DialogDescription>{t("modalSubtitle")}</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted-foreground">
            {t("ratingLabel")}
          </legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((v) => {
              const active = (rating ?? 0) >= v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-label={`${v} star`}
                  aria-pressed={active}
                  onClick={() => setRating(v === rating ? null : v)}
                  className="rounded p-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Star
                    size={20}
                    className={
                      active
                        ? "fill-rating text-rating"
                        : "text-muted-foreground"
                    }
                  />
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field label={t("textareaLabel")}>
          {(field) => (
            <Textarea
              {...field}
              className="min-h-28"
              placeholder={t("textareaPlaceholder")}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={submitting}
            />
          )}
        </Field>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
