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
      return [["setup"]];
    case "doctor":
      return [["dev:doctor"]];
    case "dev":
      return [["dev:all"]];
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
        `Unknown starter action: ${action}. Use install, setup, doctor, dev, build, or lint.`,
      );
  }
}
