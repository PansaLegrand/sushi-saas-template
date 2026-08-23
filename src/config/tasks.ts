// Centralized, code-based pricing for Tasks (mock-first)
// Adjust these constants to tune credits consumption without environment vars.

export const TEXT2VIDEO_COST = {
  CREDITS_PER_SECOND: 1,
  MULTIPLIER: {
    landscape: 1,
    portrait: 1,
    square: 1,
  },
  MIN_CREDITS: 1,
} as const;

/** Reference workflow: one generated image always consumes five credits. */
export const IMAGE_GENERATION_COST_CREDITS = 5;

/**
 * Provider attempts stop before the job's attempts do, leaving durable retry
 * budget for the exactly-once refund if the provider is terminally unavailable.
 */
export const IMAGE_GENERATION_PROVIDER_ATTEMPTS = 5;
export const IMAGE_GENERATION_JOB_ATTEMPTS = 8;
