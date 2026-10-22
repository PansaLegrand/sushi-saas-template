/** A minimal starter must not silently provision or build the optional authoring app. */
import { describe, expect, it } from "vitest";
import {
  starterCommands,
  starterEnvironment,
  starterProfile,
} from "../../scripts/lib/starter-profiles.mjs";

describe("starter profiles", () => {
  it("keeps the default full stack explicit and rejects typos", () => {
    expect(starterProfile("publishing")).toMatchObject({
      admin: true,
      studio: true,
    });
    expect(() => starterProfile("pro" as any)).toThrow(
      "Unknown starter profile",
    );
    expect(() => starterCommands(starterProfile("core"), "deploy")).toThrow(
      "Unknown starter action",
    );
  });
  it("core retains tests, web and worker but omits admin and Studio builds", () => {
    const core = starterProfile("core");
    expect(core).toMatchObject({ admin: false, studio: false });
    expect(starterCommands(core, "build")).toEqual([
      ["test:run"],
      ["build:web"],
      ["bundle:runtime"],
    ]);
    expect(starterCommands(core, "install")).toEqual([
      ["--filter", "sushi-saas-starter", "install", "--frozen-lockfile"],
    ]);
    expect(starterCommands(core, "lint")).toEqual([
      ["config:check"],
      ["lint:web"],
      ["db:lint"],
    ]);
  });
  it("operations adds admin and publishing adds Studio validation", () => {
    expect(starterCommands(starterProfile("operations"), "build")).toEqual([
      ["test:run"],
      ["build:web"],
      ["bundle:runtime"],
      ["build:admin"],
    ]);
    expect(
      starterCommands(starterProfile("publishing"), "build"),
    ).toContainEqual(["test:studio"]);
    expect(
      starterCommands(starterProfile("publishing"), "build"),
    ).toContainEqual(["build:studio"]);
  });
  it.each(["core", "operations", "publishing"])(
    "%s setup invokes the application script rather than pnpm's shell installer",
    (name) => {
      expect(starterCommands(starterProfile(name), "setup")).toEqual([
        ["run", "setup"],
      ]);
    },
  );
  it("seeds before starting the demo and scopes integration overrides to that action", () => {
    const core = starterProfile("core");
    expect(starterCommands(core, "demo")).toEqual([
      ["dev:doctor"],
      ["dev:seed"],
      ["dev:all", "--", "--skip-doctor"],
    ]);
    const inherited = {
      STRIPE_PRIVATE_KEY: "configured-test-value",
      STRIPE_WEBHOOK_SECRET: "configured-test-webhook",
      RESEND_API_KEY: "configured-test-value",
      SLACK_WEBHOOK_URL: "https://example.invalid/webhook",
      ENABLE_IMAGE_GENERATION_MOCK: "false",
      IMAGE_GENERATION_MOCK_FAILURES: "3",
    };
    const demo = { ...inherited, ...starterEnvironment(core, "demo") };
    expect(demo).toMatchObject({
      SAAS_STARTER_PROFILE: "core",
      ENABLE_DEMO_FEATURES: "true",
      ENABLE_IMAGE_GENERATION_MOCK: "true",
      IMAGE_GENERATION_MOCK_FAILURES: "0",
      NEXT_PUBLIC_CAPTCHA_ENABLED: "false",
      AUTH_DEV_EMAIL_LINKS: "true",
      STRIPE_PRIVATE_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      RESEND_API_KEY: "",
      SLACK_WEBHOOK_URL: "",
    });
    expect({ ...inherited, ...starterEnvironment(core, "dev") }).toEqual({
      ...inherited,
      SAAS_STARTER_PROFILE: "core",
    });
    expect(inherited.STRIPE_PRIVATE_KEY).toBe("configured-test-value");
  });
});
