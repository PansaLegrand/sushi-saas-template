"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: React.ReactNode;
  /** Helper text under the control. Wired to the input via aria-describedby. */
  description?: React.ReactNode;
  /** When set, the control is marked aria-invalid and the message is announced. */
  error?: string | null;
  required?: boolean;
  className?: string;
  /**
   * Receives the ids and validity state to spread onto the control, so callers
   * cannot forget to associate them:
   *
   *   <Field label="Email" error={emailError}>
   *     {(field) => <Input type="email" {...field} />}
   *   </Field>
   */
  children: (field: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    "aria-required": boolean | undefined;
  }) => React.ReactNode;
}

/**
 * Label + control + description + error, associated by id.
 *
 * Every form in the kit previously wrote its own `<label><span>…</span><input/></label>`
 * and rendered errors as a loose `<p>` that no screen reader connected to the
 * field. This makes the correct wiring the path of least effort.
 */
function Field({
  label,
  description,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = React.useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </Label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}

      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
