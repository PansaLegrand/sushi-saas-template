import journal from "./migrations/meta/_journal.json";

type MigrationJournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

const entries = journal.entries as MigrationJournalEntry[];

/**
 * Migration markers compiled into this application artifact.
 *
 * A database may legitimately be ahead of a running artifact during an
 * expand/contract deployment. Readiness therefore requires every marker this
 * artifact knows about, while allowing additional markers from a newer release.
 */
export const REQUIRED_MIGRATION_MARKERS = entries.map((entry) => entry.when);
export const REQUIRED_MIGRATION_COUNT = REQUIRED_MIGRATION_MARKERS.length;

export type MigrationReadinessState = {
  applied: number;
  requiredApplied: number;
};

export function hasRequiredMigrations({
  applied,
  requiredApplied,
}: MigrationReadinessState): boolean {
  return (
    REQUIRED_MIGRATION_COUNT > 0 &&
    applied >= REQUIRED_MIGRATION_COUNT &&
    requiredApplied === REQUIRED_MIGRATION_COUNT
  );
}
