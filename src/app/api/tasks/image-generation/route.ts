import { z } from "zod";

import { isImageGenerationMockEnabled } from "@/lib/demo-flags";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { startOfUtcMonth } from "@/lib/time";
import { countTasksByOrgSince } from "@/models/task";
import { getOrgContext } from "@/services/authz";
import { enforceLimit, requireEntitlement } from "@/services/entitlements";
import { createImageGenerationTask } from "@/services/tasks/image-generation";
import { toTaskRecord } from "@/services/tasks/presentation";
import type { CreateImageGenerationResponse } from "@/types/task";

const ImageGenerationSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export async function POST(req: Request) {
  if (!isImageGenerationMockEnabled()) {
    return respCode("RESOURCE_NOT_FOUND");
  }

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "tasks");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    await requireEntitlement(ctx.orgUuid, "tasks.image_generation");
    await enforceLimit(ctx.orgUuid, "tasks.perMonth", {
      current: await countTasksByOrgSince(ctx.orgUuid, startOfUtcMonth()),
      adding: 1,
    });

    const payload = await parseJsonBody(req, ImageGenerationSchema);
    const idempotencyKey =
      payload.idempotencyKey ?? req.headers.get("idempotency-key") ?? "";
    if (!idempotencyKey.trim()) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "idempotencyKey" },
      });
    }
    const result = await createImageGenerationTask({
      orgUuid: ctx.orgUuid,
      userUuid: ctx.userUuid,
      prompt: payload.prompt,
      idempotencyKey,
    });
    const data: CreateImageGenerationResponse = {
      task: await toTaskRecord(result.task),
      replayed: result.replayed,
    };

    return respData(data, {
      status: data.task.status === "succeeded" || data.task.status === "failed"
        ? 200
        : 202,
    });
  } catch (error) {
    return respError(error, {
      logFields: { event: "task.image_generation.create_failed" },
      fallback: "TASK_CREATE_FAILED",
    });
  }
}
