/** A blocked first clone must fail, and Core recovery must not require optional applications. */
import { describe, expect, it } from "vitest";
import {
  bootstrapNextSteps,
  bootstrapPrerequisiteResult,
  bootstrapRecovery,
} from "../../scripts/lib/bootstrap-guidance.mjs";
import { starterProfile } from "../../scripts/lib/starter-profiles.mjs";

const available = {
  dockerAvailable: true,
  dockerRunning: true,
  composeAvailable: true,
  postgresPortInUse: false,
  postgresComposeRunning: false,
  redisPortInUse: false,
  redisComposeRunning: false,
};
const paths = {
  appEnv: ".env.development.local",
  studioEnv: "apps/content-studio/.env.development.local",
};

describe("bootstrap prerequisite decisions", () => {
  it.each([
    [{ dockerAvailable: false }, "docker-missing"],
    [{ dockerRunning: false }, "docker-stopped"],
    [{ composeAvailable: false }, "compose-missing"],
    [{ postgresPortInUse: true }, "postgres-port-conflict"],
    [{ redisPortInUse: true }, "redis-port-conflict"],
  ])("returns a failing exit result for %s", (state, reason) => {
    expect(bootstrapPrerequisiteResult({ ...available, ...state })).toEqual({
      ok: false,
      exitCode: 1,
      reason,
    });
  });

  it("permits a free port or this stack's existing PostgreSQL", () => {
    expect(bootstrapPrerequisiteResult(available)).toEqual({
      ok: true,
      exitCode: 0,
      reason: null,
    });
    expect(
      bootstrapPrerequisiteResult({
        ...available,
        postgresPortInUse: true,
        postgresComposeRunning: true,
      }),
    ).toEqual({ ok: true, exitCode: 0, reason: null });
  });

  it("reports the missing tool before downstream checks that could not run", () => {
    expect(
      bootstrapPrerequisiteResult({
        ...available,
        dockerAvailable: false,
        dockerRunning: false,
        composeAvailable: false,
      }),
    ).toMatchObject({ reason: "docker-missing" });
  });

  it("accepts an existing owned Redis container but rejects an unverified foreign listener", () => {
    expect(bootstrapPrerequisiteResult({
      ...available, redisPortInUse: true, redisComposeRunning: true,
    })).toEqual({ ok: true, exitCode: 0, reason: null });
    expect(bootstrapPrerequisiteResult({
      ...available, redisPortInUse: true, redisComposeRunning: false,
    })).toEqual({ ok: false, exitCode: 1, reason: "redis-port-conflict" });
  });
});

describe("profile-specific bootstrap recovery", () => {
  it.each(["core", "operations"])(
    "%s database recovery excludes optional authoring setup",
    (name) => {
      const recovery = bootstrapRecovery(
        starterProfile(name),
        "postgres-port-conflict",
        paths,
      );
      expect(recovery).toContain(`pnpm starter ${name} setup`);
      expect(recovery).toContain("createdb sushi_dev");
      expect(recovery).toContain("createdb sushi_test");
      expect(recovery).toContain("createdb sushi_restore_drill");
      expect(recovery).toContain("pnpm db:migrate");
      expect(recovery).toContain("pnpm test:db:setup");
      expect(recovery).not.toMatch(
        /sushi_content|CONTENT_DATABASE_URL|content-studio|studio:migrate/,
      );
      expect(recovery).toContain("does not complete this bootstrap");
    },
  );

  it("publishing recovery keeps its isolated authoring database and migration", () => {
    const recovery = bootstrapRecovery(
      starterProfile("publishing"),
      "postgres-port-conflict",
      paths,
    );
    expect(recovery).toContain("createdb sushi_content");
    expect(recovery).toContain(paths.studioEnv);
    expect(recovery).toContain("CONTENT_DATABASE_URL");
    expect(recovery).toContain("pnpm studio:migrate");
  });

  it("foreign Redis recovery never claims adoption of the running service", () => {
    const recovery = bootstrapRecovery(starterProfile("core"), "redis-port-conflict", paths);
    expect(recovery).toContain("port 6379");
    expect(recovery).toContain("will not adopt or alter the existing listener");
    expect(recovery).toContain("before writing environment files");
    expect(recovery).toContain("pnpm starter core setup");
    expect(recovery).not.toMatch(/admin:promote|studio/);
  });

  it.each(["docker-missing", "docker-stopped", "compose-missing"])(
    "%s gives the selected retry without claiming setup completion",
    (reason) => {
      const recovery = bootstrapRecovery(starterProfile("core"), reason, paths);
      expect(recovery).toContain("Bootstrap incomplete");
      expect(recovery).toContain("before writing environment files");
      expect(recovery).toContain("pnpm starter core setup");
      expect(recovery).not.toMatch(/Ready\.|admin:promote|studio/);
    },
  );

  it("Core next steps require its doctor and exclude admin promotion", () => {
    const next = bootstrapNextSteps(starterProfile("core"));
    expect(next).toContain("pnpm starter core doctor");
    expect(next).toContain("After the doctor passes");
    expect(next).toContain("pnpm starter core demo");
    expect(next).toContain("pnpm starter core dev");
    expect(next).not.toMatch(/Ready\.|admin:promote|studio/);
  });

  it.each(["operations", "publishing"])(
    "%s retains optional admin onboarding",
    (name) => {
      expect(bootstrapNextSteps(starterProfile(name))).toContain(
        "pnpm admin:promote",
      );
    },
  );
});
