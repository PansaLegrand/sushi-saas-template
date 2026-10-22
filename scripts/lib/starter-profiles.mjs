/** Process/tool selection only. Never a runtime entitlement or security flag. */
export function starterProfile(
  value = process.env.SAAS_STARTER_PROFILE || "publishing",
) {
  const profiles = {
    core: { name: "core", admin: false, studio: false },
    operations: { name: "operations", admin: true, studio: false },
    publishing: { name: "publishing", admin: true, studio: true },
  };
  if (!Object.hasOwn(profiles, value))
    throw new Error(
      `Unknown starter profile: ${value}. Use core, operations, or publishing.`,
    );
  return profiles[value];
}

export function starterCommands(profile, action) {
  switch (action) {
    case "install":
      return [
        profile.studio
          ? ["install", "--frozen-lockfile"]
          : ["--filter", "sushi-saas-starter", "install", "--frozen-lockfile"],
      ];
    case "setup":
      // `pnpm setup` configures pnpm itself and may edit the user's shell rc.
      // The explicit run form is required for our package script of that name.
      return [["run", "setup"]];
    case "doctor":
      return [["dev:doctor"]];
    case "dev":
      return [["dev:all"]];
    case "demo":
      return [["dev:doctor"], ["dev:seed"], ["dev:all", "--", "--skip-doctor"]];
    case "build":
      return [
        ["test:run"],
        ["build:web"],
        ["bundle:runtime"],
        ...(profile.admin ? [["build:admin"]] : []),
        ...(profile.studio ? [["test:studio"], ["build:studio"]] : []),
      ];
    case "lint":
      return [
        ["config:check"],
        ["lint:web"],
        ...(profile.admin ? [["lint:admin"]] : []),
        ...(profile.studio ? [["lint:studio"]] : []),
        ["db:lint"],
      ];
    default:
      throw new Error(
        `Unknown starter action: ${action}. Use install, setup, doctor, demo, dev, build, or lint.`,
      );
  }
}

/** Demo choices are process-local. Existing development profiles stay untouched. */
export function starterEnvironment(profile, action) {
  return {
    SAAS_STARTER_PROFILE: profile.name,
    ...(action === "demo"
      ? {
          ENABLE_DEMO_FEATURES: "true",
          ENABLE_IMAGE_GENERATION_MOCK: "true",
          IMAGE_GENERATION_MOCK_FAILURES: "0",
          NEXT_PUBLIC_CAPTCHA_ENABLED: "false",
          AUTH_DEV_EMAIL_LINKS: "true",
          RESEND_API_KEY: "",
          SLACK_WEBHOOK_URL: "",
          STRIPE_PRIVATE_KEY: "",
          STRIPE_WEBHOOK_SECRET: "",
        }
      : {}),
  };
}
