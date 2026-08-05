import { describe, expect, it } from "vitest";
import { MarketingMessageSchema } from "./contracts";
import { renderCampaignPreview } from "./render";

const message = {
  campaignKey: "release-2026-08",
  locale: "en" as const,
  subject: "Release notes",
  preheader: "A short summary",
  template: {
    accentColor: "#15856f",
    pageBackgroundColor: "#f4f3ee",
    contentBackgroundColor: "#ffffff",
    footerText: "Product news",
    companyAddress: "1 Example Street",
  },
  blocks: [
    { type: "text" as const, text: "Hello <reader>", align: "left" as const },
  ],
};

describe("marketing campaign contract", () => {
  it("validates the same safe message shape used by the SaaS gateway", () => {
    expect(MarketingMessageSchema.safeParse(message).success).toBe(true);
    expect(
      MarketingMessageSchema.safeParse({ ...message, subject: "Hello\nBcc: x@example.com" })
        .success,
    ).toBe(false);
  });

  it("escapes preview content and shows compliance ownership", () => {
    const html = renderCampaignPreview(MarketingMessageSchema.parse(message));
    expect(html).toContain("Hello &lt;reader&gt;");
    expect(html).toContain("1 Example Street");
    expect(html).toContain("provided by the SaaS");
  });
});
