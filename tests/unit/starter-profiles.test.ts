/** A minimal starter must not silently provision or build the optional authoring app. */
import { describe, expect, it } from "vitest";
import {
  starterCommands,
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
});
