export type TaskIntent = {
  prompt: string;
  idempotencyKey: string | null;
  seconds?: string;
  aspectRatio?: string;
};

export function readTaskIntent(key?: string): TaskIntent | null {
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (typeof value?.prompt !== "string" || value.prompt.length > 1_000)
      return null;
    if (
      value.idempotencyKey !== null &&
      (typeof value.idempotencyKey !== "string" ||
        !value.idempotencyKey.trim() ||
        value.idempotencyKey.length > 255)
    )
      return null;
    if (
      value.seconds !== undefined &&
      (typeof value.seconds !== "string" || value.seconds.length > 8)
    )
      return null;
    if (
      value.aspectRatio !== undefined &&
      !["landscape", "portrait", "square"].includes(value.aspectRatio)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function saveTaskIntent(
  key: string | undefined,
  value: TaskIntent,
): void {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled; the URL still holds the replay identity. */
  }
}

/** URL identity survives reload even when browser storage is unavailable. */
export function updateTaskLocation(values: {
  task?: string | null;
  intent?: string | null;
}): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}
