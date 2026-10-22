/**
 * Better Auth's optional Vitest peer serves only its test-utils export, which
 * this application does not use. Keep the test runner development-only.
 * Scope this to the reviewed version; review upstream packaging on upgrades.
 */
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "better-auth" && pkg.version === "1.7.6") {
        delete pkg.peerDependencies?.vitest;
        delete pkg.peerDependenciesMeta?.vitest;
      }
      return pkg;
    },
  },
};
