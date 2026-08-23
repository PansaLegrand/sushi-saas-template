import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const MIGRATION_POLICY_BASELINE_INDEX = 34;
// These predate the Drizzle journal and are not loaded by the migrator. Keep
// the finite list visible; new unjournaled SQL files fail the gate.
const LEGACY_UNJOURNALED_FILES = new Set([
  "0001_add_user_role.sql",
  "0002_reservations.sql",
]);

const RULES = [
  {
    id: "destructive-drop",
    message: "DROP TABLE/COLUMN requires a separate contract release",
    pattern: /\bdrop\s+(?:table|column)\b/i,
  },
  {
    id: "rename",
    message: "renames require an expand/backfill/contract rollout",
    pattern: /\balter\s+table\b[\s\S]*?\brename\s+(?:column\s+)?\b/i,
  },
  {
    id: "set-not-null",
    message: "SET NOT NULL requires a prior backfill and compatibility release",
    pattern: /\balter\s+(?:column\s+)?[^;]+\bset\s+not\s+null\b/i,
  },
  {
    id: "blocking-unique-index",
    message: "unique indexes on existing data should be created concurrently",
    pattern: /\bcreate\s+unique\s+index(?!\s+concurrently)\b/i,
    predicate: (statement, source) => {
      const table = statement.match(/\bon\s+["']?([a-z0-9_]+)["']?/i)?.[1];
      if (!table) return true;
      return !new RegExp(
        `\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["']?${table}["']?\\b`,
        "i",
      ).test(source);
    },
  },
  {
    id: "unbounded-delete",
    message: "DELETE without WHERE can erase a complete table",
    pattern: /\bdelete\s+from\b/i,
    predicate: (statement) => !/\bwhere\b/i.test(statement),
  },
  {
    id: "unbounded-update",
    message: "UPDATE without WHERE rewrites a complete table",
    pattern: /\bupdate\s+(?!set\b)["']?[a-z0-9_]+/i,
    predicate: (statement) => !/\bwhere\b/i.test(statement),
  },
];

function allowedRules(sql) {
  return new Set(
    [
      ...sql.matchAll(
        /^\s*--\s*migration-safety:\s*allow\s+([a-z0-9-]+)\s+-\s+\S.+$/gim,
      ),
    ].map((match) => match[1]),
  );
}

export function inspectMigrationSql(sql) {
  const allowed = allowedRules(sql);
  const findings = [];

  for (const rule of RULES) {
    if (allowed.has(rule.id)) continue;
    const matches = sql.match(new RegExp(rule.pattern.source, "gi")) ?? [];
    if (rule.predicate) {
      const statements = sql.split(";").map((statement) => `${statement};`);
      if (
        !statements.some(
          (statement) =>
            rule.pattern.test(statement) && rule.predicate(statement, sql),
        )
      ) {
        continue;
      }
    } else if (matches.length === 0) {
      continue;
    }
    findings.push({ rule: rule.id, message: rule.message });
  }

  return findings;
}

export function inspectMigrationDirectory(migrationsDirectory) {
  const journalPath = resolve(migrationsDirectory, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const entries = journal.entries ?? [];
  const sqlFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const findings = [];

  for (const entry of entries) {
    const filename = `${entry.tag}.sql`;
    if (!existsSync(resolve(migrationsDirectory, filename))) {
      findings.push({
        file: filename,
        rule: "missing-file",
        message: "journal entry has no SQL file",
      });
    }
  }
  for (const filename of sqlFiles) {
    const tag = filename.replace(/\.sql$/, "");
    if (
      !entries.some((entry) => entry.tag === tag) &&
      !LEGACY_UNJOURNALED_FILES.has(filename)
    ) {
      findings.push({
        file: filename,
        rule: "missing-journal",
        message: "SQL file has no journal entry",
      });
    }
  }

  for (const entry of entries.filter(
    (candidate) => candidate.idx > MIGRATION_POLICY_BASELINE_INDEX,
  )) {
    const filename = `${entry.tag}.sql`;
    const path = resolve(migrationsDirectory, filename);
    if (!existsSync(path)) continue;
    for (const finding of inspectMigrationSql(readFileSync(path, "utf8"))) {
      findings.push({ file: filename, ...finding });
    }
  }

  return findings;
}
