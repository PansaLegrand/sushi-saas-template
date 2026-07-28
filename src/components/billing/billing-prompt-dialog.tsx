"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BillingBlock, BillingBlockKind } from "@/lib/errors/billing";
import { cn } from "@/lib/utils";

/**
 * The dialog a user sees when the server says they have to pay for something.
 *
 * Deliberately a modal rather than an inline banner. This is not an error in
 * the usual sense — the request was well-formed and the user did nothing wrong;
 * it is a decision point, and it is the one moment in the product where an
 * upgrade is the obvious next action rather than an interruption. Burying that
 * in a red box at the top of a form is how a template ends up with a credits
 * system nobody tops up.
 *
 * Copy is chosen by `kind`, and every string comes from `messages/`. Nothing
 * here reads `error.message`, and nothing branches on which tier is required —
 * the tier is a label, translated when we have a name for it and passed
 * through when we do not, so adding a tier needs no change to this file.
 */

const TITLE_KEY: Record<BillingBlockKind, string> = {
  credits: "creditsTitle",
  feature: "featureTitle",
  limit: "limitTitle",
};

export function BillingPromptDialog({
  block,
  open,
  onOpenChange,
}: {
  block: BillingBlock | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("billing.prompt");

  // Keep the dialog mounted through its close animation, but render nothing
  // when there has never been a block to describe.
  if (!block) return null;

  const tierLabel = block.requiredTier
    ? t.has(`tiers.${block.requiredTier}`)
      ? t(`tiers.${block.requiredTier}`)
      : block.requiredTier
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No corner X: the footer's "Not now" is the way out, and two controls
          that both announce the same label is worse than one that is obvious.
          Escape still closes, as `tests/components/dialog.test.tsx` pins. */}
      <DialogContent hideCloseButton>
        <DialogHeader>
          <DialogTitle>{t(TITLE_KEY[block.kind])}</DialogTitle>
          <DialogDescription>
            {describe({ t, block, tierLabel })}
          </DialogDescription>
        </DialogHeader>

        {block.kind === "credits" && block.available !== undefined ? (
          <p className="text-sm text-muted-foreground">
            {t("balance", { available: block.available })}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>
            {t("dismiss")}
          </DialogClose>
          <Link
            href="/account/billing"
            className={cn(buttonVariants({ variant: "outline" }))}
            onClick={() => onOpenChange(false)}
          >
            {t("manageBilling")}
          </Link>
          <Link
            href="/pricing"
            className={cn(buttonVariants())}
            onClick={() => onOpenChange(false)}
          >
            {t("viewPlans")}
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pick the most specific sentence the payload supports.
 *
 * Three levels, worst case first: no numbers at all (a route that predates the
 * richer `details`), a shortfall, or a shortfall plus the tier that fixes it.
 * Every level is a complete, sensible sentence on its own — the specific copy
 * is an upgrade, never a requirement, because the failure mode to avoid is a
 * dialog that says "You need undefined more credits".
 */
function describe({
  t,
  block,
  tierLabel,
}: {
  t: ReturnType<typeof useTranslations<"billing.prompt">>;
  block: BillingBlock;
  tierLabel: string | null;
}): string {
  if (block.kind === "credits") {
    return block.shortfall !== undefined && block.shortfall > 0
      ? t("creditsShortfall", { shortfall: block.shortfall })
      : t("creditsDescription");
  }

  if (block.kind === "limit") {
    return tierLabel
      ? t("limitDescriptionTier", { tier: tierLabel })
      : t("limitDescription");
  }

  return tierLabel
    ? t("featureDescriptionTier", { tier: tierLabel })
    : t("featureDescription");
}
