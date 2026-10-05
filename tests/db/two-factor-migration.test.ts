/**
 * The auth upgrade must preserve enrolled accounts without promoting pending
 * secrets. Run the actual migration against the old table shape to prove both
 * the backfill and compatibility defaults without touching the public schema.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postgres from "postgres";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";

const migration = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0037_neat_excalibur.sql"),
  "utf8",
);

describeDb("two-factor schema migration (real database)", () => {
  useCleanDatabase();

  it("preserves confirmed enrollments and defaults other secrets to unverified", async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) throw new Error("TEST_DATABASE_URL is required");

    const schema = `two_factor_migration_${randomUUID().replaceAll("-", "")}`;
    const client = postgres(testUrl, { max: 1, prepare: false });

    try {
      await client.unsafe(`create schema "${schema}"`);
      await client.begin(async (tx) => {
        await tx.unsafe(`set local search_path to "${schema}", public`);
        await tx.unsafe(`
          create table "users" (
            "id" varchar(255) primary key,
            "uuid" varchar(255) not null,
            "two_factor_enabled" boolean not null default false
          );
          create table "two_factor" (
            "id" varchar(255) primary key,
            "user_id" varchar(255) not null unique,
            "secret" text not null,
            "backup_codes" text not null
          );
          insert into "users" ("id", "uuid", "two_factor_enabled") values
            ('enabled-id', 'enabled-uuid', true),
            ('pending-id', 'pending-uuid', false);
          insert into "two_factor" ("id", "user_id", "secret", "backup_codes") values
            ('enabled', 'enabled-id', 'encrypted-enabled', 'encrypted-backup-enabled'),
            ('pending', 'pending-id', 'encrypted-pending', 'encrypted-backup-pending'),
            ('orphan', 'enabled-uuid', 'encrypted-orphan', 'encrypted-backup-orphan');
        `);

        for (const statement of migration.split("--> statement-breakpoint")) {
          if (statement.trim()) await tx.unsafe(statement);
        }

        // An older writer can still omit every added column after expansion.
        await tx`
          insert into "two_factor" ("id", "user_id", "secret", "backup_codes")
          values ('new', 'new-user', 'encrypted-new', 'encrypted-backup-new')
        `;
        const rows = await tx`
          select "id", "verified", "failed_verification_count", "locked_until",
                 "secret", "backup_codes"
          from "two_factor" order by "id"
        `;

        expect(rows).toEqual(
          ["enabled", "new", "orphan", "pending"].map((id) => ({
            id,
            verified: id === "enabled",
            failed_verification_count: 0,
            locked_until: null,
            secret: `encrypted-${id}`,
            backup_codes: `encrypted-backup-${id}`,
          })),
        );
      });
    } finally {
      await client.unsafe(`drop schema if exists "${schema}" cascade`);
      await client.end({ timeout: 5 });
    }
  });
});
