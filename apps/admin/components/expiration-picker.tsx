"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DayPicker } from "@daypicker/react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ExpirationKind = "plan" | "credits";

interface ExpirationPickerProps {
  kind: ExpirationKind;
  value: string | null;
  onChange: (value: string | null) => void;
  subject?: string;
  disabled?: boolean;
}

const quickDurations = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function localTime(date: Date | undefined): string {
  if (!date) return "23:59";
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function exactDateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function combineLocalDateAndTime(date: Date, time: string): Date | null {
  const [hours, minutes] = time.split(":").map(Number);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}

function consequence(
  kind: ExpirationKind,
  subject: string,
  expiresAt: Date | undefined,
): string {
  if (!expiresAt) {
    return kind === "plan"
      ? `${subject} stays active until an admin revokes it.`
      : "Unused credits from this grant remain available until they are spent.";
  }

  const exact = exactDateTime(expiresAt);
  return kind === "plan"
    ? `${subject} ends automatically on ${exact}. The user's next eligible subscription, or Free plan, then takes over.`
    : `Unused credits from this grant stop being spendable on ${exact}. Credits already spent are unaffected.`;
}

export function ExpirationPicker({
  kind,
  value,
  onChange,
  subject = "Complimentary access",
  disabled,
}: ExpirationPickerProps) {
  const selectedValue = useMemo(() => parseDate(value), [value]);
  const [draftDate, setDraftDate] = useState<Date | undefined>(selectedValue);
  const [draftTime, setDraftTime] = useState(() => localTime(selectedValue));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftDate(selectedValue);
    setDraftTime(localTime(selectedValue));
    setError(null);
  }, [selectedValue]);

  const applyCustomExpiration = (date: Date, time: string) => {
    setDraftDate(date);
    setDraftTime(time);
    const combined = combineLocalDateAndTime(date, time);

    if (!combined || combined.getTime() <= Date.now()) {
      setError("Choose a date and time in the future.");
      return;
    }

    setError(null);
    onChange(combined.toISOString());
  };

  const setQuickExpiration = (days: number) => {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setError(null);
    onChange(expiresAt.toISOString());
  };

  const clearExpiration = () => {
    setError(null);
    onChange(null);
  };

  const description = consequence(kind, subject, selectedValue);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Field
      label="Expiration"
      description={description}
      error={error}
      className="min-w-0"
    >
      {(field) => (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              {...field}
              type="button"
              variant="outline"
              disabled={disabled}
              className="w-full justify-start gap-2 overflow-hidden px-3 text-left font-normal"
            >
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">
                {selectedValue ? exactDateTime(selectedValue) : "Never expires"}
              </span>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            className="max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
            collisionPadding={16}
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">When should it expire?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Never is the default. Presets count from this exact moment.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={value === null ? "default" : "outline"}
                  onClick={clearExpiration}
                >
                  Never
                </Button>
                {quickDurations.map((option) => (
                  <Button
                    key={option.days}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setQuickExpiration(option.days)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>

              <div className="rounded-md border p-2">
                <DayPicker
                  key={value ?? "never"}
                  mode="single"
                  selected={draftDate}
                  defaultMonth={draftDate}
                  disabled={{ before: today }}
                  navLayout="around"
                  onSelect={(date) => {
                    if (date) applyCustomExpiration(date, draftTime);
                  }}
                  style={
                    {
                      "--rdp-accent-color": "var(--primary)",
                      "--rdp-accent-background-color": "var(--accent)",
                    } as CSSProperties
                  }
                />
              </div>

              <Field
                label="Time"
                description={`Your local timezone: ${
                  Intl.DateTimeFormat().resolvedOptions().timeZone
                }`}
              >
                {(timeField) => (
                  <Input
                    {...timeField}
                    type="time"
                    value={draftTime}
                    onChange={(event) => {
                      const time = event.currentTarget.value;
                      setDraftTime(time);
                      if (draftDate) applyCustomExpiration(draftDate, time);
                    }}
                  />
                )}
              </Field>

              <div
                className="rounded-md bg-muted p-3 text-xs leading-relaxed"
                aria-live="polite"
              >
                <span className="font-medium">What this means: </span>
                {error ?? description}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </Field>
  );
}
