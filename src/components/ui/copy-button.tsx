"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  value: string;
  /** Button text before copying. */
  label?: string;
  /** Names *what* is being copied, for screen readers: "Copy backup codes". */
  ariaLabel?: string;
  size?: "sm" | "default";
  variant?: "secondary" | "outline" | "ghost";
  className?: string;
  disabled?: boolean;
}

/** How long the confirmation stays up. Long enough to notice, short enough not to nag. */
const CONFIRM_MS = 1500;

/**
 * Copy-to-clipboard with visible confirmation.
 *
 * Exists because the alternative is what people actually do with a secret shown
 * once on screen: select it by hand and, when that is fiddly, screenshot it.
 * A screenshot of a TOTP secret or a set of backup codes is a credential
 * sitting in a photo library and, often, in a cloud sync.
 *
 * Failure is surfaced rather than swallowed. `navigator.clipboard` needs a
 * secure context and can be refused by permissions policy, and a button that
 * silently does nothing leaves the user believing they have the value.
 */
export function CopyButton({
  value,
  label = "Copy",
  ariaLabel,
  size = "sm",
  variant = "secondary",
  className,
  disabled,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Without this, copying and then navigating away sets state on an unmounted
  // component — a warning in dev and a leak in a long-lived page.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);

    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }

    timer.current = setTimeout(() => setState("idle"), CONFIRM_MS);
  }, [value]);

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() => void copy()}
      disabled={disabled || !value}
      aria-label={ariaLabel ?? label}
    >
      {state === "copied" ? (
        <Check className="mr-1 h-4 w-4" aria-hidden />
      ) : (
        <Copy className="mr-1 h-4 w-4" aria-hidden />
      )}
      {/* Announced on change so a screen reader hears the outcome, which the
          icon swap alone does not convey. */}
      <span aria-live="polite">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : label}
      </span>
    </Button>
  );
}

export default CopyButton;
