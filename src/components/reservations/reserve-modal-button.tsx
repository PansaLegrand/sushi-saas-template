"use client";

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
import { cn } from "@/lib/utils";

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
  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          buttonClassName ??
            "rounded-md bg-foreground px-6 py-3 text-base font-medium text-background shadow-sm transition hover:shadow-md"
        )}
      >
        {label}
      </DialogTrigger>

      <DialogContent closeLabel={closeLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`mailto:${email}`}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            {emailCtaLabel}
          </a>
          <span className="text-xs text-muted-foreground">{email}</span>
        </div>

        <DialogFooter>
          <DialogClose className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-foreground/5">
            {closeLabel}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
