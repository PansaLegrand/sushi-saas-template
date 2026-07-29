export type TurnstileWidgetSize = "normal" | "compact";

/** Cloudflare's normal widget is 300px wide; anything narrower needs compact. */
export function turnstileSizeForWidth(
  availableWidth: number,
): TurnstileWidgetSize {
  return availableWidth < 300 ? "compact" : "normal";
}
