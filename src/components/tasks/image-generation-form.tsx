"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  createImageGenerationTask,
  getTask,
  newTaskIdempotencyKey,
} from "@/api/tasks";
import { BillingPromptDialog } from "@/components/billing/billing-prompt-dialog";
import { useBillingPrompt } from "@/components/billing/use-billing-prompt";
import { ErrorBanner } from "@/components/errors/error-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";
import type { TaskRecord } from "@/types/task";

const POLL_INTERVAL_MS = 1_500;
const ACTIVE_STATUSES = new Set([
  "pending_payment",
  "queued",
  "running",
  "refunding",
]);

export function ImageGenerationForm({
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  /** Test and embedded-surface override; product pages use the default. */
  pollIntervalMs?: number;
} = {}) {
  const t = useTranslations("tasks.imageGeneration");
  const locale = useLocale();
  const {
    prompt: promptBilling,
    clear: clearBilling,
    dialogProps: billingDialogProps,
  } = useBillingPrompt();
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const submission = useRef<Promise<void> | null>(null);

  const handleError = useCallback(
    (error: unknown) => {
      if (isClientApiError(error) && error.code === "AUTH_REQUIRED") {
        setNeedsSignIn(true);
      } else {
        promptBilling(error);
      }
      setErrorMessage(resolveErrorMessage(error, locale, "TASK_CREATE_FAILED"));
    },
    [locale, promptBilling],
  );

  const submit = useCallback(() => {
    if (submission.current || !prompt.trim()) return submission.current;

    const operation = (async () => {
      setIsSubmitting(true);
      setErrorMessage(null);
      setNeedsSignIn(false);
      clearBilling();
      idempotencyKey.current ??= newTaskIdempotencyKey();

      try {
        const response = await createImageGenerationTask({
          prompt: prompt.trim(),
          idempotencyKey: idempotencyKey.current,
        });
        setTask(response.task);
      } catch (error) {
        handleError(error);
      } finally {
        setIsSubmitting(false);
        submission.current = null;
      }
    })();

    submission.current = operation;
    return operation;
  }, [clearBilling, handleError, prompt]);

  useEffect(() => {
    if (!task || !ACTIVE_STATUSES.has(task.status)) return;

    const timer = window.setTimeout(() => {
      void getTask(task.uuid)
        .then(({ task: current }) => {
          setTask(current);
          setErrorMessage(null);
        })
        .catch(handleError);
    }, pollIntervalMs);

    return () => window.clearTimeout(timer);
  }, [handleError, pollIntervalMs, task]);

  return (
    <div className="grid gap-6">
      {errorMessage ? (
        <ErrorBanner title={t("errorTitle")} message={errorMessage} />
      ) : null}

      <BillingPromptDialog {...billingDialogProps} />

      {needsSignIn ? (
        <Alert>
          <AlertTitle>{t("signInTitle")}</AlertTitle>
          <AlertDescription>
            {t("signInDescription")} {" "}
            <Link href="/login" className="font-medium underline">
              {t("signInAction")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("formTitle")}</CardTitle>
          <CardDescription>{t("cost", { credits: 5 })}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field label={t("promptLabel")} required>
            {(field) => (
              <Textarea
                {...field}
                value={prompt}
                maxLength={1_000}
                rows={5}
                placeholder={t("promptPlaceholder")}
                onChange={(event) => {
                  setPrompt(event.currentTarget.value);
                  idempotencyKey.current = null;
                }}
              />
            )}
          </Field>

          <Button
            type="button"
            disabled={!prompt.trim() || isSubmitting}
            onClick={() => void submit()}
          >
            {isSubmitting ? t("submitting") : t("submit")}
          </Button>
        </CardContent>
      </Card>

      {task ? (
        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>{t("taskTitle")}</CardTitle>
            <CardDescription>
              {t("taskId")}: <span className="font-mono">{task.uuid}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Alert
              role="status"
              variant={task.status === "failed" ? "destructive" : "default"}
            >
              <AlertTitle>{t("statusLabel")}</AlertTitle>
              <AlertDescription>{t(`status.${task.status}`)}</AlertDescription>
            </Alert>

            {task.outputUrl ? (
              <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                <Image
                  src={task.outputUrl}
                  alt={t("imageAlt")}
                  width={1024}
                  height={1024}
                  unoptimized
                  className="h-auto w-full"
                />
              </div>
            ) : null}

            {task.status === "failed" ? (
              <p className="text-sm text-destructive">
                {t("generationFailed")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
