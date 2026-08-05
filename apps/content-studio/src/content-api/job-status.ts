type JobLogEntry = {
  executedAt?: unknown;
  completedAt?: unknown;
  taskSlug?: unknown;
  state?: unknown;
  output?: unknown;
  error?: unknown;
};

export function jobOwnerIdentity(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const identity = (input as Record<string, unknown>).identity;
  return typeof identity === "string" && identity.length > 0 ? identity : null;
}

export function sanitizedJobLog(log: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(log)) return [];

  return log.map((value) => {
    const entry = (value && typeof value === "object" ? value : {}) as JobLogEntry;
    return {
      executedAt: entry.executedAt,
      completedAt: entry.completedAt,
      taskSlug: entry.taskSlug,
      state: entry.state,
      output: entry.output,
      ...(entry.error ? { error: "TASK_FAILED" } : {})
    };
  });
}
