import { describe, expect, it } from "vitest";
import type { PayloadRequest } from "payload";
import { canPublish, hasAutomationScope, studioUsersOrPublished } from "@/lib/authz";

function request(user: unknown): Pick<PayloadRequest, "user"> {
  return { user } as Pick<PayloadRequest, "user">;
}

describe("content authorization", () => {
  it("lets publishers publish but not writers", () => {
    expect(canPublish(request({ collection: "users", role: "publisher" }))).toBe(true);
    expect(canPublish(request({ collection: "users", role: "writer" }))).toBe(false);
  });

  it("uses explicit machine scopes", () => {
    const machine = request({
      collection: "service-accounts",
      scopes: ["content:draft:create"]
    });
    expect(hasAutomationScope(machine, "content:draft:create")).toBe(true);
    expect(hasAutomationScope(machine, "content:publish")).toBe(false);
  });

  it("rejects expired machine credentials even when the key has a scope", () => {
    const machine = request({
      collection: "service-accounts",
      scopes: ["content:draft:create"],
      expiresAt: "2020-01-01T00:00:00.000Z"
    });
    expect(hasAutomationScope(machine, "content:draft:create")).toBe(false);
  });

  it("limits anonymous collection reads to published documents", () => {
    expect(studioUsersOrPublished({ req: request(null) as PayloadRequest })).toEqual({
      _status: { equals: "published" }
    });
  });
});
