import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJsonBody } from "@/lib/http/request";

const Schema = z.object({
  name: z.string().trim().min(1),
  count: z.coerce.number().int().positive().optional(),
});

function request(body?: string) {
  return new Request("http://test.local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("parses and validates JSON with zod", async () => {
    await expect(
      parseJsonBody(request(JSON.stringify({ name: "  Sushi  ", count: "2" })), Schema)
    ).resolves.toEqual({ name: "Sushi", count: 2 });
  });

  it("uses a default for empty optional bodies", async () => {
    await expect(
      parseJsonBody(request(""), z.object({ includeLedger: z.boolean().optional() }), {
        defaultValue: {},
      })
    ).resolves.toEqual({});
  });

  it("turns malformed JSON into a catalogued app error", async () => {
    await expect(parseJsonBody(request("{"), Schema)).rejects.toMatchObject({
      code: "REQUEST_MALFORMED_JSON",
      statusCode: 400,
    });
  });

  it("turns schema failures into safe validation details", async () => {
    await expect(parseJsonBody(request(JSON.stringify({ name: "" })), Schema)).rejects.toMatchObject({
      code: "REQUEST_VALIDATION_FAILED",
      statusCode: 400,
      details: {
        fields: [expect.objectContaining({ field: "name" })],
      },
    });
  });
});
