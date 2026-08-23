import { AppError } from "@/lib/errors";
import {
  cancelPendingJobByUuid,
  findJobByUuid,
  retryFailedJobByUuid,
  type JobRow,
} from "@/models/job";

import type { JobType } from "./types";

/**
 * Standalone notifications have no second domain state to reconcile.
 *
 * Credits, storage cleanup, account lifecycle, and campaign deliveries must be
 * canceled from their owning workflow, which updates both records together.
 */
const OPERATOR_CANCELABLE_JOB_TYPES = new Set<JobType>([
  "marketing_test_email",
  "welcome_email",
  "payment_success_email",
  "payment_failed_email",
  "reservation_confirmed_email",
  "org_invitation_email",
  "slack_event",
  "slack_error",
]);

export function isOperatorCancelableJobType(type: string): boolean {
  return OPERATOR_CANCELABLE_JOB_TYPES.has(type as JobType);
}

async function explainRejectedTransition(
  uuid: string,
  expectedStatus: "failed" | "pending",
): Promise<never> {
  const existing = await findJobByUuid(uuid);
  if (!existing) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      details: { resource: "job", uuid },
    });
  }

  throw new AppError("JOB_STATE_CONFLICT", {
    message: `job must be ${expectedStatus} for this operation`,
    details: {
      field: "status",
      expected: expectedStatus,
      actual: existing.status,
    },
  });
}

/** Retry a failed job through one atomic, state-guarded transition. */
export async function retryFailedJob(uuid: string): Promise<JobRow> {
  const retried = await retryFailedJobByUuid(uuid);
  if (retried) return retried;
  return explainRejectedTransition(uuid, "failed");
}

/** Cancel only standalone pending notifications with no owning domain record. */
export async function cancelPendingJob(uuid: string): Promise<JobRow> {
  const existing = await findJobByUuid(uuid);
  if (!existing) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      details: { resource: "job", uuid },
    });
  }
  if (existing.status !== "pending") {
    throw new AppError("JOB_STATE_CONFLICT", {
      details: {
        field: "status",
        expected: "pending",
        actual: existing.status,
      },
    });
  }
  if (!isOperatorCancelableJobType(existing.type)) {
    throw new AppError("JOB_CANCELLATION_FORBIDDEN", {
      details: { type: existing.type },
    });
  }

  const canceled = await cancelPendingJobByUuid(uuid);
  if (canceled) return canceled;
  return explainRejectedTransition(uuid, "pending");
}
