import { describe, expect, it } from "vitest";

import { inspectMigrationSql } from "../../scripts/migration-policy.mjs";

describe("migration safety policy", () => {
  it("allows additive expand-phase DDL", () => {
    expect(
      inspectMigrationSql(`
        alter table "users" add column "timezone" varchar(64);
        create index concurrently "users_timezone_idx" on "users" ("timezone");
      `),
    ).toEqual([]);

    expect(
      inspectMigrationSql(`
        create table "widgets" ("id" integer not null);
        create unique index "widgets_id_idx" on "widgets" ("id");
      `),
    ).toEqual([]);
  });

  it("flags contract and blocking operations", () => {
    const findings = inspectMigrationSql(`
      alter table "users" drop column "legacy";
      alter table "users" rename column "name" to "display_name";
      alter table "users" alter column "email" set not null;
      create unique index "users_email_idx" on "users" ("email");
      delete from "sessions";
      update "users" set "locale" = 'en';
    `);

    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining([
        "destructive-drop",
        "rename",
        "set-not-null",
        "blocking-unique-index",
        "unbounded-delete",
        "unbounded-update",
      ]),
    );
  });

  it("requires a rule-specific annotation with a reviewable reason", () => {
    expect(
      inspectMigrationSql(`
        -- migration-safety: allow destructive-drop - contract release after two compatible deploys
        alter table "users" drop column "legacy";
      `),
    ).toEqual([]);

    expect(
      inspectMigrationSql(`
        -- migration-safety: allow destructive-drop
        alter table "users" drop column "legacy";
      `).map((finding) => finding.rule),
    ).toContain("destructive-drop");
  });
});
