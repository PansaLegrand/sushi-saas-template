/**
 * Compare the database's Drizzle journal with the migrations in this checkout.
 *
 * Drizzle itself decides what to run from the newest timestamp. That is enough
 * to apply a normal append-only journal, but it cannot identify a deleted,
 * reordered, or edited historical migration. The deployment runner uses this
 * stricter prefix check before and after applying migrations.
 */
export function inspectMigrationState(applied, expected) {
  const sharedLength = Math.min(applied.length, expected.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const databaseMigration = applied[index];
    const repositoryMigration = expected[index];

    if (
      Number(databaseMigration.folderMillis) !==
      Number(repositoryMigration.folderMillis)
    ) {
      return {
        status: "diverged",
        pending: [],
        reason:
          `migration ${index + 1} has marker ` +
          `${databaseMigration.folderMillis} in the database but ` +
          `${repositoryMigration.folderMillis} in the repository`,
      };
    }

    if (databaseMigration.hash !== repositoryMigration.hash) {
      return {
        status: "diverged",
        pending: [],
        reason:
          `migration ${index + 1} (${repositoryMigration.tag}) has a different ` +
          "SQL hash in the database",
      };
    }
  }

  if (applied.length > expected.length) {
    return {
      status: "diverged",
      pending: [],
      reason:
        `the database has ${applied.length} migrations but this repository ` +
        `contains only ${expected.length}; refusing to run an older artifact`,
    };
  }

  const pending = expected.slice(applied.length);
  return {
    status: pending.length === 0 ? "current" : "pending",
    pending,
  };
}
