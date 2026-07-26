import { z } from "zod";

import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { startOfUtcMonth } from "@/lib/time";
import { countTasksByOrgSince } from "@/models/task";
import { enforceLimit, requireEntitlement } from "@/services/entitlements";
import { getOrgContext } from "@/services/authz";
import { createTextToVideoTask } from "@/services/tasks";
import type { CreateTextToVideoResponse } from "@/types/task";

const TextToVideoSchema = z.object({
  prompt: z.string().trim().optional(),
  seconds: z.coerce.number().positive().optional(),
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

    // Plan gate before anything is parsed or spent. Two checks, because they
    // fail for different reasons and the user needs to be told which: the
    // first means "your plan never included this", the second means "it does,
    // and you have used this month's allowance".
    await requireEntitlement(ctx.orgUuid, "tasks.text_to_video");
    // Org-wide: the monthly allowance is bought by the tenant, so five members
    // share one quota rather than getting five.
    await enforceLimit(ctx.orgUuid, "tasks.perMonth", {
      current: await countTasksByOrgSince(ctx.orgUuid, startOfUtcMonth()),
      adding: 1,
    });

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
        : req.headers.get("idempotency-key") ?? undefined;

    const { task } = await createTextToVideoTask({
      orgUuid: ctx.orgUuid,
      userUuid: ctx.userUuid,
      input: { prompt: payload.prompt, seconds, aspectRatio },
      idempotencyKey,
    });

    const data: CreateTextToVideoResponse = {
      task: {
        uuid: task.uuid,
        userUuid: task.user_uuid,
        type: task.type,
        status: task.status as any,
        creditsUsed: task.credits_used,
        creditsTransNo: task.credits_trans_no ?? undefined,
        idempotencyKey: task.idempotency_key ?? undefined,
        userInput: task.user_input ?? undefined,
        outputUrl: task.output_url ?? undefined,
        outputJson: task.output_json ?? undefined,
        errorMessage: task.error_message ?? undefined,
        startedAt: task.started_at?.toISOString() ?? null,
        completedAt: task.completed_at?.toISOString() ?? null,
        createdAt: task.created_at?.toISOString() ?? new Date().toISOString(),
        updatedAt: task.updated_at?.toISOString() ?? new Date().toISOString(),
      },
    };

    return respData(data);
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
