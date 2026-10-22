/** Pure bootstrap decisions and recovery text; no commands or infrastructure I/O. */
export function bootstrapPrerequisiteResult({
  dockerAvailable,
  dockerRunning,
  composeAvailable,
  postgresPortInUse,
  postgresComposeRunning,
  redisPortInUse,
  redisComposeRunning,
}) {
  const reason = !dockerAvailable
    ? "docker-missing"
    : !dockerRunning
      ? "docker-stopped"
      : !composeAvailable
        ? "compose-missing"
        : postgresPortInUse && !postgresComposeRunning
          ? "postgres-port-conflict"
          : redisPortInUse && !redisComposeRunning
            ? "redis-port-conflict"
            : null;
  return reason
    ? { ok: false, exitCode: 1, reason }
    : { ok: true, exitCode: 0, reason: null };
}

export function bootstrapRecovery(profile, reason, paths) {
  const retry = `pnpm starter ${profile.name} setup`;
  const unchanged =
    "Setup stopped before writing environment files, starting containers, or applying migrations.";
  switch (reason) {
    case "docker-missing":
      return `Bootstrap incomplete: Docker was not found.\n\n${unchanged}\nInstall Docker with Compose v2, start its daemon, then run:\n\n  ${retry}`;
    case "docker-stopped":
      return `Bootstrap incomplete: the Docker daemon is unavailable.\n\n${unchanged}\nStart Docker and verify that docker info succeeds, then run:\n\n  ${retry}`;
    case "compose-missing":
      return `Bootstrap incomplete: Docker Compose v2 is unavailable.\n\n${unchanged}\nInstall the Compose plugin and verify that docker compose version succeeds, then run:\n\n  ${retry}`;
    case "redis-port-conflict":
      return `Bootstrap incomplete: port 6379 is occupied by a service outside this Compose stack.\n\n${unchanged}\nThe bundled doctor and development runner require this repository's Redis container. This bootstrap will not adopt or alter the existing listener. Move or stop that service when safe, then run:\n\n  ${retry}\n\nIf you deliberately keep external Redis, configure and verify it through the documented manual development workflow instead of treating this bootstrap as complete.`;
    case "postgres-port-conflict": {
      const databases = [
        "sushi_dev",
        "sushi_test",
        ...(profile.studio ? ["sushi_content"] : []),
        "sushi_restore_drill",
      ];
      const commands = databases
        .map((database) => `  createdb ${database}`)
        .join("\n");
      const studio = profile.studio
        ? `\nCreate or update ${paths.studioEnv} from apps/content-studio/.env.example with its required secrets, and set CONTENT_DATABASE_URL to a separate sushi_content database.\n  pnpm studio:migrate\n`
        : "";
      return `Bootstrap incomplete: port 5432 is occupied by a service outside this Compose stack.\n\n${unchanged}\nTo use the bundled stack, move or stop the conflicting service when safe, then run:\n\n  ${retry}\n\nIf you deliberately keep an existing PostgreSQL server, provision these databases manually:\n\n${commands}\n\nCreate or update ${paths.appEnv} from .env.example with that server's credentials for DATABASE_URL, TEST_DATABASE_URL and RESTORE_DATABASE_URL. Keep test and restore databases separate from the application database.\nApply the selected profile's migrations against those configured URLs:\n\n  pnpm db:migrate\n  pnpm test:db:setup\n${studio}\nManual database setup does not complete this bootstrap: Redis and private object storage must also be configured and checked. The bundled doctor and unified runner expect this repository's Compose services; use the documented manual development commands for external infrastructure.`;
    }
    default:
      throw new Error(`Unknown bootstrap prerequisite failure: ${reason}`);
  }
}

export function bootstrapNextSteps(profile) {
  const admin = profile.admin
    ? "\nAfter signing up, promote your account if you need the admin console:\n\n  pnpm admin:promote you@example.com\n"
    : "";
  return `Local infrastructure and migrations completed for ${profile.name}.\n\nBefore starting, verify the selected environment and services:\n\n  pnpm starter ${profile.name} doctor\n\nAfter the doctor passes:\n\n  pnpm starter ${profile.name} demo   → seed a local account and run the image example\n  pnpm starter ${profile.name} dev    → normal development with your integrations\n  pnpm test:db                       → run the database tier\n${admin}`;
}
