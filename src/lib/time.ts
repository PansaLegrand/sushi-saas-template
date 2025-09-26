/**
 * Returns the ISO timestamp string for the provided date (defaults to `new Date()`).
 */
export function getIsoTimestr(date: Date = new Date()): string {
  return date.toISOString();
}
