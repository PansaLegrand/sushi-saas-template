// Lightweight Slack webhook helper for server-side notifications.
// Configure an Incoming Webhook URL in Slack and set SLACK_WEBHOOK_URL in env.

import { logger } from "@/lib/logger/server";
import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";

function serialize(obj: unknown): string {
  try {
    if (!obj) return "";
    if (obj instanceof Error) {
      return `${obj.name}: ${obj.message}\n${obj.stack ?? ""}`.slice(0, 4000);
    }
    if (typeof obj === "string") return obj.slice(0, 4000);
    return JSON.stringify(obj, null, 2).slice(0, 4000);
  } catch {
    return "[unserializable]";
  }
}

async function post(payload: Record<string, unknown>): Promise<void> {
  const webhook = getAppEnv().SLACK_WEBHOOK_URL;
  if (!webhook) return; // disabled
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AppError("SERVICE_UNAVAILABLE", {
        message: `Slack webhook returned HTTP ${response.status}`,
        details: {
          provider: "slack",
          retryAfter: response.headers.get("retry-after") ?? undefined,
        },
      });
    }
  } catch (e) {
    logger.warn(
      { err: e, event: "slack.webhook_failed" },
      "slack webhook failed",
    );
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendSlackMessage(
  text: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const payload = {
    text: text + (context ? `\n\n${"```"}${serialize(context)}${"```"}` : ""),
  } as const;
  await post(payload as any);
}

export function notifySlackError(
  title: string,
  error?: unknown,
  context?: Record<string, unknown>,
): void {
  const message = `:rotating_light: ${title}`;
  const c = { ...(context || {}), error: serialize(error) };
  queueMicrotask(() => {
    void sendSlackMessage(message, c);
  });
}

export function notifySlackEvent(
  title: string,
  context?: Record<string, unknown>,
): void {
  const message = `:white_check_mark: ${title}`;
  queueMicrotask(() => {
    void sendSlackMessage(message, context);
  });
}
