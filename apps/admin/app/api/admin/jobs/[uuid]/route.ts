import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { cancelPendingJob, retryFailedJob } from "@/services/jobs/operator";

const JobActionSchema = z.object({
  action: z.enum(["retry", "cancel"]),
  note: z.string().trim().min(1).max(2000),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ uuid: string }> },
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;
  const { uuid } = await context.params;

  let input: z.infer<typeof JobActionSchema>;
  try {
    input = await parseJsonBody(req, JobActionSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.job_action_invalid", job_uuid: uuid },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  const auditAction = input.action === "retry" ? "job.retry" : "job.cancel";
  try {
    const job =
      input.action === "retry"
        ? await retryFailedJob(uuid)
        : await cancelPendingJob(uuid);

    await writeAdminAuditLog({
      actor: admin,
      action: auditAction,
      targetType: "job",
      targetUuid: uuid,
      note: input.note,
      metadata: {
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
      },
      request: req,
    });

    return respData({ uuid: job.uuid, status: job.status });
  } catch (error) {
    await writeAdminAuditLog({
      actor: admin,
      action: auditAction,
      targetType: "job",
      targetUuid: uuid,
      status: "failed",
      note: input.note,
      errorMessage: error instanceof Error ? error.message : String(error),
      request: req,
    });
    return respError(error, {
      logFields: {
        event: "admin.job_action_failed",
        job_uuid: uuid,
        action: input.action,
      },
      fallback: "SERVER_ERROR",
    });
  }
}
