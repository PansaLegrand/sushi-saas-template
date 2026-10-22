import {
  IMAGE_GENERATION_JOB_ATTEMPTS,
  TEXT2VIDEO_JOB_ATTEMPTS,
} from "@/config/tasks";
import { logger } from "@/lib/logger/server";
import { startOfUtcMonth } from "@/lib/time";
import {
  admitPaidTask,
  listTaskDispatchRepairs,
} from "@/models/task-admission";
import { CreditsTransType } from "@/services/credit";

const specifications = {
  image_generation: {
    spendPrefix: "task_image",
    transType: CreditsTransType.TaskImageGeneration,
    maxAttempts: IMAGE_GENERATION_JOB_ATTEMPTS,
  },
  text_to_video: {
    spendPrefix: "task_video",
    transType: CreditsTransType.TaskTextToVideo,
    maxAttempts: TEXT2VIDEO_JOB_ATTEMPTS,
  },
};

/** Repair paid durable intents. Unfingerprinted legacy provider outcomes need an operator. */
export async function reconcilePaidTaskDispatch(
  now = new Date(),
): Promise<number> {
  const candidates = await listTaskDispatchRepairs(
    new Date(now.getTime() - 5 * 60_000),
  );
  let repaired = 0;
  for (const task of candidates) {
    const spec = specifications[task.type as keyof typeof specifications];
    if (!spec || !task.idempotency_key || !task.request_fingerprint) continue;
    try {
      const outcome = await admitPaidTask({
        task: {
          ...task,
          idempotency_key: task.idempotency_key,
          request_fingerprint: task.request_fingerprint,
        },
        maxTasks: null,
        since: startOfUtcMonth(),
        ...spec,
        repairOnly: true,
      });
      if (outcome.ok) repaired += 1;
    } catch (err) {
      logger.error(
        { err, task_uuid: task.uuid },
        "task dispatch repair failed",
      );
    }
  }
  return repaired;
}
