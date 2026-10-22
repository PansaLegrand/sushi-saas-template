import { AppError } from "@/lib/errors";

/** Useful checkpointed progress is a continuation, not a failed attempt. */
export class JobContinuation extends AppError {
  readonly delayMs = 1_000;
  constructor() {
    super("SERVICE_UNAVAILABLE", {
      message: "job yielded after checkpointed progress",
    });
  }
}

export function createJobWorkBudget(maxEffects = 25, deadlineAt?: number) {
  let completed = 0;
  return {
    checkpoint() {
      completed += 1;
      if (
        completed >= maxEffects ||
        (deadlineAt !== undefined && Date.now() >= deadlineAt - 10_000)
      ) {
        throw new JobContinuation();
      }
    },
  };
}
