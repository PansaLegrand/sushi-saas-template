import { z } from "zod";

import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getOrgContext } from "@/services/authz";
import { createTextToVideoTask } from "@/services/tasks";
import { toTaskRecord } from "@/services/tasks/presentation";
import type { CreateTextToVideoResponse } from "@/types/task";

const TextToVideoSchema = z.object({
  prompt: z.string().trim().max(1_000).optional(),
  seconds: z.coerce.number().int().min(1).max(60).optional(),
  aspectRatio: z.enum(["landscape", "portrait", "square"]).optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(req: Request) {
  if (!isTextToVideoMockEnabled()) {
    return respCode("RESOURCE_NOT_FOUND");
  }

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "tasks");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const payload = await parseJsonBody(req, TextToVideoSchema);

    if (!payload.prompt) {
      return respCode("TASK_PROMPT_REQUIRED", {
        details: { field: "prompt" },
      });
    }

    const seconds = Math.max(1, Number(payload.seconds ?? 8));
    const aspectRatio = payload.aspectRatio ?? "landscape";
    const idempotencyKey =
      typeof payload.idempotencyKey === "string"
        ? payload.idempotencyKey
        : (req.headers.get("idempotency-key") ?? undefined);

    if (!idempotencyKey?.trim())
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "idempotencyKey" },
      });

    const { task } = await createTextToVideoTask({
      orgUuid: ctx.orgUuid,
      userUuid: ctx.userUuid,
      input: { prompt: payload.prompt, seconds, aspectRatio },
      idempotencyKey,
    });

    const data: CreateTextToVideoResponse = {
      task: await toTaskRecord(task),
    };

    return respData(data, {
      status: ["succeeded", "failed"].includes(task.status) ? 200 : 202,
    });
  } catch (error) {
    // toAppError maps known throws ("insufficient credits" -> CREDITS_INSUFFICIENT
    // via the catalog's legacy aliases), so the branching on message text that
    // used to live here is gone. Anything unrecognized becomes TASK_CREATE_FAILED
    // with its real message going only to the log.
    return respError(error, {
      logFields: { event: "task.text_to_video.create_failed" },
      fallback: "TASK_CREATE_FAILED",
    });
  }
}
