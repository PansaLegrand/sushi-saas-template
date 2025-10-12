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

