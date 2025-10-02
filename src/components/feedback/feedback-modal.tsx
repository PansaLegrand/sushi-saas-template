"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

export default function FeedbackModal() {
  const t = useTranslations("feedback");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState("");
  const [rating, setRating] = useState<number | null>(null);

  const reset = () => {
    setContent("");
    setRating(null);
  };

  const onSubmit = async () => {
    if (!content || content.trim().length < 3) {
      toast.error(t("errorTooShort"));
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), rating: rating ?? undefined }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.code !== 0) {
        toast.error(data?.message || t("submitError"));
        return;
      }

      toast.success(t("submitSuccess"));
      reset();
      setOpen(false);
    } catch (e) {
      console.error(e);
      toast.error(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Button onClick={() => setOpen(true)} variant="secondary">
        {t("buttonLabel")}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => (!submitting ? setOpen(false) : null)}
          />
          <div className="relative z-50 w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold">{t("modalTitle")}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{t("modalSubtitle")}</p>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-muted-foreground">
                {t("ratingLabel")}
              </label>
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => {
                  const v = i + 1;
                  const active = (rating ?? 0) >= v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-label={`${v} star`}
                      onClick={() => setRating(v === rating ? null : v)}
                      className="p-1"
                    >
                      <Star
                        size={20}
                        className={active ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-1">
              <label className="mb-2 block text-sm font-medium text-muted-foreground">
                {t("textareaLabel")}
              </label>
              <textarea
                className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder={t("textareaPlaceholder")}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                {t("cancel")}
              </Button>
              <Button onClick={onSubmit} disabled={submitting}>
                {submitting ? t("sending") : t("send")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
