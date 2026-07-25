"use client";

import React, { useCallback, useEffect, useId, useState } from "react";

type Props = {
  label: string;
  title: string;
  description: string;
  email?: string;
  closeLabel?: string;
  emailCtaLabel?: string;
  buttonClassName?: string;
};

export default function ReserveModalButton({
  label,
  title,
  description,
  email = "pansalegrand@gmail.com",
  closeLabel = "Close",
  emailCtaLabel = "Email me",
  buttonClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descId = useId();

  const close = useCallback(() => setOpen(false), []);
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onKey]);

  return (
    <>
      <button
        type="button"
        className={
          buttonClassName ??
          "rounded-md bg-foreground px-6 py-3 text-base font-medium text-background shadow-sm transition hover:shadow-md"
        }
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="w-full max-w-md rounded-xl border border-border/60 bg-background p-6 text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 id={titleId} className="text-lg font-semibold">
                {title}
              </h3>
              <button
                aria-label={closeLabel}
                className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground transition hover:bg-foreground/5"
                onClick={close}
              >
                ✕
              </button>
            </div>
            <p id={descId} className="mb-4 text-sm text-muted-foreground">
              {description}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`mailto:${email}`}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
              >
                {emailCtaLabel}
              </a>
              <span className="text-xs text-muted-foreground">{email}</span>
              <button
                className="ml-auto rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-foreground/5"
                onClick={close}
              >
                {closeLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

