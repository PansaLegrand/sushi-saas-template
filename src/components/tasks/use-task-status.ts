"use client";

import { useEffect } from "react";
import { getTask } from "@/api/tasks";
import { isClientApiError } from "@/lib/errors/client";
import type { TaskRecord } from "@/types/task";

export function isActiveTask(task: TaskRecord | null): boolean {
  return Boolean(task && !["succeeded", "failed"].includes(task.status));
}

/** A failed read must not strand a paid task until the user submits again. */
export function useTaskStatus({
  task,
  onTask,
  onError,
  intervalMs = 1_500,
}: {
  task: TaskRecord | null;
  onTask: (task: TaskRecord) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
}) {
  const uuid = task?.uuid;
  const status = task?.status;
  useEffect(() => {
    if (!uuid) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let failures = 0;
    let active = status !== "succeeded" && status !== "failed";
    const schedule = () => {
      if (active && !controller.signal.aborted) {
        timer = setTimeout(
          poll,
          Math.min(
            30_000,
            Math.max(1, intervalMs) * 2 ** Math.min(failures, 5),
          ),
        );
      }
    };
    const poll = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const { task: current } = await getTask(uuid, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        active = isActiveTask(current);
        onTask(current);
      } catch (error) {
        if (controller.signal.aborted) return;
        failures += 1;
        if (isClientApiError(error) && [401, 403, 404].includes(error.status))
          active = false;
        onError(error);
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      if (timer) clearTimeout(timer);
      void poll();
    };
    schedule();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [uuid, status, onTask, onError, intervalMs]);
}
