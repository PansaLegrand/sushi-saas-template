import { describe, expect, it } from "vitest";
import { requestHash, scopedIdempotencyKey } from "@/content-api/idempotency";

describe("content API idempotency", () => {
  it("scopes a caller-supplied key to the authenticated machine identity", () => {
    const first = scopedIdempotencyKey("service-accounts:1", "workflow-run-42");
    const second = scopedIdempotencyKey("service-accounts:2", "workflow-run-42");

    expect(first).not.toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toContain("workflow-run-42");
  });

  it("includes the operation in the request fingerprint", () => {
    const body = { locale: "en", slug: "example" };
    expect(requestHash("create-draft", body)).not.toBe(
      requestHash("create-brief", body)
    );
  });
});
