import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  hasRequiredMigrations,
  REQUIRED_MIGRATION_MARKERS,
} from "@/db/migration-manifest";
import { AppError } from "@/lib/errors/app-error";

export type DatabaseReadiness = {
  migrationsApplied: number;
};

/**
 * Prove the application can query the database and contains every migration
 * compiled into this artifact. A database that is ahead remains ready so the
 * safe deploy order (migrate, verify, then ship code) does not take the
 * currently-running release out of service.
 */
export async function checkDatabaseReadiness(): Promise<DatabaseReadiness> {
  await db().execute(sql`select 1`);

  if (REQUIRED_MIGRATION_MARKERS.length === 0) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "application migration manifest is empty",
    });
  }

  const requiredMarkers = sql.join(
    REQUIRED_MIGRATION_MARKERS.map((marker) => sql`${marker}`),
    sql`, `,
  );
  const result = await db().execute(sql`
    select
      count(*)::int as "applied",
      count(*) filter (
        where "created_at" in (${requiredMarkers})
      )::int as "requiredApplied"
    from "drizzle"."__drizzle_migrations"
  `);
  const rows = result as unknown as
    | Array<{ applied: number; requiredApplied: number }>
    | { rows: Array<{ applied: number; requiredApplied: number }> };
  const row = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  const migrationState = {
    applied: Number(row?.applied ?? 0),
    requiredApplied: Number(row?.requiredApplied ?? 0),
  };

  if (!hasRequiredMigrations(migrationState)) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message:
        "database migration journal does not contain every migration required by this release",
    });
  }

  return { migrationsApplied: migrationState.applied };
}
