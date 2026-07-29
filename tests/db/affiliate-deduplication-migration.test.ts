/**
 * Database tier: affiliate uniqueness migration evidence.
 *
 * Without this test, a cleanup migration can silently regress to deleting
 * duplicate financial rows before preserving them. It executes the real
 * migration files in an isolated schema and proves every removed row remains
 * reconstructable with its canonical row and cleanup reason.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";

const migration23 = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0023_woozy_kronos.sql"),
  "utf8",
);
const migration24 = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0024_fancy_mikhail_rasputin.sql"),
  "utf8",
);
const migration28 = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0028_grey_post.sql"),
  "utf8",
);

async function runMigration(
  tx: postgres.TransactionSql,
  migration: string,
): Promise<void> {
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await tx.unsafe(statement);
  }
}

describeDb("affiliate deduplication migrations (real database)", () => {
  useCleanDatabase();

  it("adds the archive safely to a database that already ran the old cleanup", async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) throw new Error("TEST_DATABASE_URL is required");

    const schema = `affiliate_compat_${randomUUID().replaceAll("-", "")}`;
    const client = postgres(testUrl, { max: 1, prepare: false });

    try {
      await client.unsafe(`create schema "${schema}"`);

      await client.begin(async (tx) => {
        await tx.unsafe(`set local search_path to "${schema}", public`);

        // This is the state of a database that already recorded 0023/0024 in
        // Drizzle's journal before the archive was added to those migrations.
        await runMigration(tx, migration28);

        const columns = await tx<{ column_name: string }[]>`
          select "column_name"
          from "information_schema"."columns"
          where "table_schema" = ${schema}
            and "table_name" = 'affiliate_deduplication_archive'
          order by "ordinal_position"
        `;
        expect(columns.map(({ column_name }) => column_name)).toEqual([
          "archive_id",
          "original_affiliate_id",
          "canonical_affiliate_id",
          "reason",
          "original_row_json",
          "archived_at",
        ]);

        const indexes = await tx<{ indexname: string }[]>`
          select "indexname"
          from "pg_indexes"
          where "schemaname" = ${schema}
            and "tablename" = 'affiliate_deduplication_archive'
        `;
        expect(indexes.map(({ indexname }) => indexname)).toContain(
          "affiliate_dedup_archive_original_reason_unique_idx",
        );
      });
    } finally {
      await client
        .unsafe(`drop schema if exists "${schema}" cascade`)
        .catch(() => {});
      await client.end({ timeout: 5 });
    }
  });

  it("archives every removed row before installing uniqueness", async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (!testUrl) throw new Error("TEST_DATABASE_URL is required");

    const schema = `affiliate_migration_${randomUUID().replaceAll("-", "")}`;
    const client = postgres(testUrl, { max: 1, prepare: false });

    try {
      await client.unsafe(`create schema "${schema}"`);

      await client.begin(async (tx) => {
        await tx.unsafe(`set local search_path to "${schema}", public`);
        await tx.unsafe(`
          create table "affiliates" (
            "id" integer primary key generated always as identity,
            "user_uuid" varchar(255) not null,
            "created_at" timestamp with time zone,
            "status" varchar(50) default '' not null,
            "invited_by" varchar(255) not null,
            "paid_order_no" varchar(255) default '' not null,
            "paid_amount" integer default 0 not null,
            "reward_percent" integer default 0 not null,
            "reward_amount" integer default 0 not null
          )
        `);

        await tx.unsafe(`
          insert into "affiliates"
            ("user_uuid", "created_at", "status", "invited_by",
             "paid_order_no", "paid_amount", "reward_percent", "reward_amount")
          values
            ('buyer-paid', now(), 'completed', 'referrer', 'order-1', 5000, 10, 500),
            ('buyer-paid', now(), 'completed', 'referrer', 'order-1', 5000, 10, 500),
            ('buyer-paid', now(), 'completed', 'referrer', 'order-1', 5000, 10, 500),
            ('buyer-unique', now(), 'completed', 'referrer', 'order-2', 2500, 10, 250),
            ('buyer-signup', now(), 'pending', 'referrer', '', 0, 0, 0),
            ('buyer-signup', now(), 'pending', 'referrer', '', 0, 0, 0),
            ('buyer-signup', now(), 'pending', 'referrer', '', 0, 0, 0),
            ('buyer-other', now(), 'pending', 'referrer', '', 0, 0, 0)
        `);

        await runMigration(tx, migration23);
        await runMigration(tx, migration24);

        // Already-migrated environments need 0028, while a fresh install has
        // the table from 0023. Running the compatibility migration here proves
        // its IF NOT EXISTS path is genuinely harmless.
        await runMigration(tx, migration28);

        const active = await tx<
          {
            id: number;
            user_uuid: string;
            paid_order_no: string;
          }[]
        >`
          select "id", "user_uuid", "paid_order_no"
          from "affiliates"
          order by "id"
        `;
        expect(active.map(({ id }) => id)).toEqual([1, 4, 5, 8]);

        const archived = await tx<
          {
            original_affiliate_id: number;
            canonical_affiliate_id: number;
            reason: string;
            original_row_json: string;
            archived_at: Date;
          }[]
        >`
          select
            "original_affiliate_id",
            "canonical_affiliate_id",
            "reason",
            "original_row_json",
            "archived_at"
          from "affiliate_deduplication_archive"
          order by "original_affiliate_id"
        `;

        expect(
          archived.map(
            ({ original_affiliate_id, canonical_affiliate_id, reason }) => ({
              original_affiliate_id,
              canonical_affiliate_id,
              reason,
            }),
          ),
        ).toEqual([
          {
            original_affiliate_id: 2,
            canonical_affiliate_id: 1,
            reason: "duplicate_paid_order_no",
          },
          {
            original_affiliate_id: 3,
            canonical_affiliate_id: 1,
            reason: "duplicate_paid_order_no",
          },
          {
            original_affiliate_id: 6,
            canonical_affiliate_id: 5,
            reason: "duplicate_signup_attribution",
          },
          {
            original_affiliate_id: 7,
            canonical_affiliate_id: 5,
            reason: "duplicate_signup_attribution",
          },
        ]);

        const originalPaidReplay = JSON.parse(
          archived[0].original_row_json,
        ) as {
          id: number;
          user_uuid: string;
          paid_order_no: string;
          paid_amount: number;
          reward_amount: number;
        };
        expect(originalPaidReplay).toMatchObject({
          id: 2,
          user_uuid: "buyer-paid",
          paid_order_no: "order-1",
          paid_amount: 5000,
          reward_amount: 500,
        });
        expect(
          archived.every(({ archived_at }) => archived_at instanceof Date),
        ).toBe(true);
      });
    } finally {
      await client
        .unsafe(`drop schema if exists "${schema}" cascade`)
        .catch(() => {});
      await client.end({ timeout: 5 });
    }
  });
});
