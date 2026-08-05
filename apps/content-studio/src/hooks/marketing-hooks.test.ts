import { describe, expect, it } from "vitest";
import {
  prepareMarketingCampaign,
  prepareMarketingTemplate
} from "@/hooks/marketing-hooks";

function requestFor(role: "writer" | "reviewer" | "publisher" | "admin") {
  return {
    context: {},
    user: { collection: "users", role }
  };
}

describe("marketing publication hooks", () => {
  it("does not let a writer mutate an already-published template by omitting its status", async () => {
    await expect(
      prepareMarketingTemplate({
        data: { name: "Changed live template" },
        originalDoc: { _status: "published" },
        req: requestFor("writer")
      } as never)
    ).rejects.toThrow("Only publishers can publish email templates.");
  });

  it("does not let a writer mutate an already-published campaign by omitting its status", async () => {
    await expect(
      prepareMarketingCampaign({
        data: { name: "Changed live campaign" },
        originalDoc: { _status: "published", workflowStatus: "approved" },
        req: requestFor("writer")
      } as never)
    ).rejects.toThrow("Only publishers can publish campaigns.");
  });

  it("allows a publisher to update an approved published campaign", async () => {
    await expect(
      prepareMarketingCampaign({
        data: { name: "Publisher change" },
        originalDoc: { _status: "published", workflowStatus: "approved" },
        req: requestFor("publisher")
      } as never)
    ).resolves.toMatchObject({ name: "Publisher change" });
  });

  it("requires approval before a publisher can publish a campaign", async () => {
    await expect(
      prepareMarketingCampaign({
        data: { _status: "published" },
        originalDoc: { workflowStatus: "review" },
        req: requestFor("publisher")
      } as never)
    ).rejects.toThrow("Approve this campaign before publishing it.");
  });
});
