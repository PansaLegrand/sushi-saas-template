import { getSnowId } from "@/lib/hash";
import { insertTask } from "@/models/task";
import { CreditsTransType, decreaseCredits } from "@/services/credit";
import { generateTextToVideo, type TextToVideoInput } from "@/services/ai/video";
import { TEXT2VIDEO_COST } from "@/data/tasks";

export const TASK_TYPE_TEXT_TO_VIDEO = "text_to_video" as const;

export function calculateTextToVideoCost(params: {
  seconds: number;
  aspectRatio: string;
}): number {
  const aspect = (params.aspectRatio || "landscape").toLowerCase();
  const mux =
    aspect === "portrait"
      ? TEXT2VIDEO_COST.MULTIPLIER.portrait
      : aspect === "square"
      ? TEXT2VIDEO_COST.MULTIPLIER.square
      : TEXT2VIDEO_COST.MULTIPLIER.landscape;

  const base = Math.max(1, TEXT2VIDEO_COST.CREDITS_PER_SECOND) * Math.max(1, Math.round(params.seconds));
  const cost = Math.ceil(base * Math.max(0.1, mux));
  return Math.max(TEXT2VIDEO_COST.MIN_CREDITS, cost);
}

export async function createTextToVideoTask(params: {
  userUuid: string;
  input: TextToVideoInput;
}): Promise<{
  task: typeof import("@/db/schema").tasks.$inferSelect;
}> {
  const { userUuid, input } = params;

  const seconds = Number.isFinite(input.seconds as number) ? (input.seconds as number) : 8;
  const aspectRatio = input.aspectRatio ?? "landscape";
  const creditsUsed = calculateTextToVideoCost({ seconds, aspectRatio });

  const transNo = await decreaseCredits({
    user_uuid: userUuid,
    trans_type: CreditsTransType.TaskTextToVideo,
    credits: creditsUsed,
  });

  const result = await generateTextToVideo({
    prompt: input.prompt,
    seconds,
    aspectRatio,
  });

  const now = new Date();
  const uuid = getSnowId();

  const task = await insertTask({
    uuid,
    user_uuid: userUuid,
    type: TASK_TYPE_TEXT_TO_VIDEO,
    status: "succeeded",
    credits_used: creditsUsed,
    credits_trans_no: transNo,
    user_input: JSON.stringify({ prompt: input.prompt, seconds, aspect_ratio: input.aspectRatio ?? "landscape" }),
    output_url: result.outputUrl,
    created_at: now,
    updated_at: now,
    started_at: now,
    completed_at: now,
  });

  if (!task) {
    throw new Error("failed to insert task");
  }

  return { task };
}
