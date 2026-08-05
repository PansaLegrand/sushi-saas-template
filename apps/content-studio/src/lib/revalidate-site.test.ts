import { describe, expect, it } from "vitest";
import { signRevalidation } from "@/lib/revalidate-site";

describe("public site revalidation signatures", () => {
  it("binds both the timestamp and exact request body", () => {
    const secret = "test-secret";
    const body = JSON.stringify({ collection: "pages", locale: "en", slug: "tools/example" });
    const signature = signRevalidation(body, "1785686400", secret);
    expect(signature).toHaveLength(64);
    expect(signRevalidation(`${body} `, "1785686400", secret)).not.toBe(signature);
    expect(signRevalidation(body, "1785686401", secret)).not.toBe(signature);
  });
});
