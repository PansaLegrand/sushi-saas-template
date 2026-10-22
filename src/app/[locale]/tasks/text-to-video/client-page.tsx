"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createTextToVideoTask, newTaskIdempotencyKey } from "@/api/tasks";
import { BillingPromptDialog } from "@/components/billing/billing-prompt-dialog";
import { useBillingPrompt } from "@/components/billing/use-billing-prompt";
import { ErrorBanner } from "@/components/errors/error-banner";
import {
  readTaskIntent,
  saveTaskIntent,
  updateTaskLocation,
} from "@/components/tasks/task-intent";
import {
  isActiveTask,
  useTaskStatus,
} from "@/components/tasks/use-task-status";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { resolveErrorMessage } from "@/lib/errors/client";
import type { TaskRecord } from "@/types/task";

function taskInput(task: TaskRecord | null) {
  try {
    const input = JSON.parse(task?.userInput ?? "{}");
    return {
      prompt: typeof input.prompt === "string" ? input.prompt : "",
      seconds: String(input.seconds ?? 8),
      aspectRatio: input.aspect_ratio ?? "landscape",
    };
  } catch {
    return { prompt: "", seconds: "8", aspectRatio: "landscape" };
  }
}

export default function TextToVideoClientPage({
  initialTask = null,
  initialIntentKey,
  persistenceKey,
  pollIntervalMs,
}: {
  initialTask?: TaskRecord | null;
  initialIntentKey?: string;
  persistenceKey?: string;
  pollIntervalMs?: number;
}) {
  const t = useTranslations("tasks.textToVideo");
  const locale = useLocale();
  const {
    prompt: promptBilling,
    clear: clearBilling,
    dialogProps,
  } = useBillingPrompt();
  const [input, setInput] = useState(taskInput(initialTask));
  const [task, setTask] = useState(initialTask);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setError] = useState<string | null>(null);
  const key = useRef<string | null>(
    initialIntentKey?.trim() || initialTask?.idempotencyKey || null,
  );
  const submitted = useRef<string | null>(
    initialTask ? JSON.stringify(taskInput(initialTask)) : null,
  );
  const submitting = useRef(false);
  useEffect(() => {
    const saved = readTaskIntent(persistenceKey);
    const next = saved
      ? {
          prompt: saved.prompt,
          seconds: saved.seconds ?? "8",
          aspectRatio: saved.aspectRatio ?? "landscape",
        }
      : taskInput(initialTask);
    setInput(next);
    setTask(initialTask);
    key.current = saved
      ? saved.idempotencyKey
      : initialIntentKey?.trim() || initialTask?.idempotencyKey || null;
    submitted.current =
      key.current && (saved || initialTask) ? JSON.stringify(next) : null;
  }, [initialTask, initialIntentKey, persistenceKey]);
  const handleError = useCallback(
    (error: unknown) => {
      promptBilling(error);
      setError(resolveErrorMessage(error, locale, "TASK_CREATE_FAILED"));
    },
    [promptBilling, locale],
  );
  const receiveTask = useCallback((next: TaskRecord) => {
    setTask(next);
    setError(null);
  }, []);
  useTaskStatus({
    task,
    onTask: receiveTask,
    onError: handleError,
    intervalMs: pollIntervalMs,
  });
  const seconds = Number(input.seconds);
  const canSubmit =
    input.prompt.trim() &&
    Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= 60 &&
    !isSubmitting &&
    !isActiveTask(task);
  function change(update: Partial<typeof input>) {
    const next = { ...input, ...update };
    setInput(next);
    if (
      submitted.current !== null &&
      JSON.stringify(next) !== submitted.current
    ) {
      key.current = null;
      if (persistenceKey) updateTaskLocation({ intent: null });
    }
    saveTaskIntent(persistenceKey, { ...next, idempotencyKey: key.current });
  }
  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setSubmitting(true);
    setError(null);
    clearBilling();
    if (task && !isActiveTask(task)) key.current = null;
    key.current ??= newTaskIdempotencyKey();
    submitted.current = JSON.stringify(input);
    saveTaskIntent(persistenceKey, { ...input, idempotencyKey: key.current });
    if (persistenceKey) updateTaskLocation({ intent: key.current, task: null });
    try {
      const result = await createTextToVideoTask({
        prompt: input.prompt,
        seconds,
        aspectRatio: input.aspectRatio,
        idempotencyKey: key.current,
      });
      setTask(result.task);
      if (persistenceKey) updateTaskLocation({ task: result.task.uuid });
    } catch (error) {
      handleError(error);
    } finally {
      submitting.current = false;
      setSubmitting(false);
    }
  }
  return (
    <main className="container mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich("intro", { code: (chunks) => <code>{chunks}</code> })}
        </p>
      </header>
      {errorMessage ? (
        <ErrorBanner title={t("errorTitle")} message={errorMessage} />
      ) : null}
      <BillingPromptDialog {...dialogProps} />
      <Card>
        <CardContent className="grid gap-5 pt-6">
          <Field label={t("promptLabel")} required>
            {(field) => (
              <Textarea
                {...field}
                rows={4}
                maxLength={1_000}
                value={input.prompt}
                onChange={(event) =>
                  change({ prompt: event.currentTarget.value })
                }
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("secondsLabel")} required>
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={input.seconds}
                  onChange={(event) =>
                    change({ seconds: event.currentTarget.value })
                  }
                />
              )}
            </Field>
            <Field label={t("aspectLabel")}>
              {(field) => (
                <Select
                  {...field}
                  value={input.aspectRatio}
                  onChange={(event) =>
                    change({ aspectRatio: event.currentTarget.value })
                  }
                >
                  <option value="landscape">{t("aspectLandscape")}</option>
                  <option value="portrait">{t("aspectPortrait")}</option>
                  <option value="square">{t("aspectSquare")}</option>
                </Select>
              )}
            </Field>
          </div>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {isSubmitting
              ? t("generating")
              : task && !isActiveTask(task)
                ? t("generateAgain")
                : t("generate")}
          </Button>
          {task ? (
            <div aria-live="polite" className="space-y-3">
              <p>{t(`status.${task.status}`)}</p>
              <p className="text-sm text-muted-foreground">
                {t("spent", { n: task.creditsUsed })}
              </p>
              {task.outputUrl ? (
                <video
                  controls
                  playsInline
                  src={task.outputUrl}
                  className="w-full rounded-lg border border-border"
                />
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
