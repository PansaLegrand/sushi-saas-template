"use client";

import { useCallback, useMemo, useState } from "react";

import { type BillingBlock, describeBillingBlock } from "@/lib/errors/billing";

/**
 * Turn a caught API failure into an upgrade prompt, if that is what it is.
 *
 * The whole point is that a page's catch block stops enumerating billing codes:
 *
 *     const billing = useBillingPrompt();
 *
 *     } catch (error) {
 *       if (billing.prompt(error)) return;          // handled: dialog is open
 *       setMessage(resolveErrorMessage(error, locale));
 *     }
 *
 *     <BillingPromptDialog {...billing.dialogProps} />
 *
 * `prompt` returning a boolean is the load-bearing part. The alternative shape
 * — a hook that swallows everything and renders something for every error —
 * looks tidier and is wrong: pages have their own copy for their own failures,
 * and the two must not fight over who reports what. Here the page keeps the
 * fallback and gives up exactly the cases the dialog does better.
 *
 * `block` and `open` are separate state on purpose. Dismissing the dialog must
 * not erase the fact that the user is out of credits — a page that wants to
 * keep a link to pricing in the margin after the modal closes reads `block`,
 * which survives until the next attempt calls `clear()`.
 */
export function useBillingPrompt() {
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [open, setOpen] = useState(false);

  const prompt = useCallback((error: unknown): boolean => {
    const next = describeBillingBlock(error);
    if (!next) return false;

    setBlock(next);
    setOpen(true);
    return true;
  }, []);

  /** Close the dialog, keeping `block` so the page can still link out. */
  const dismiss = useCallback(() => setOpen(false), []);

  /** Re-open for the block already in hand — a "why?" link in the banner. */
  const reopen = useCallback(() => {
    setBlock((current) => {
      if (current) setOpen(true);
      return current;
    });
  }, []);

  /** Forget the block entirely. Call when a fresh attempt starts. */
  const clear = useCallback(() => {
    setOpen(false);
    setBlock(null);
  }, []);

  const dialogProps = useMemo(
    () => ({ block, open, onOpenChange: setOpen }),
    [block, open]
  );

  return { prompt, dismiss, reopen, clear, block, open, dialogProps };
}
