/** Numeric IDs overlap between collections; machine credentials cannot edit editors. */
import { describe, expect, it } from "vitest";
import type { PayloadRequest } from "payload";
import { Users } from "./users";

describe("editor account updates", () => {
  it.each([null, { id: 1, collection: "service-accounts", scopes: ["content:publish"] }])(
    "rejects anonymous and machine identities even with a matching numeric ID", async (user) => {
      expect(await Users.access!.update!({ req: { user } as PayloadRequest, id: 1 })).toBe(false);
    },
  );
  it("permits self-edit and admin edit, but refuses another writer", async () => {
    for (const [user, expected] of [
      [{ id: 1, collection: "users", role: "writer" }, true],
      [{ id: 2, collection: "users", role: "writer" }, false],
      [{ id: 2, collection: "users", role: "admin" }, true],
    ] as const) {
      expect(await Users.access!.update!({ req: { user } as PayloadRequest, id: 1 })).toBe(expected);
    }
  });
});
