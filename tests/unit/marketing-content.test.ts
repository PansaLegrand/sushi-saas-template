import { beforeEach, describe, expect, it } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import { MarketingMessageSchema } from "@/services/marketing/contracts";
import { renderMarketingMessage } from "@/services/marketing/render";
import {
  requireContentStudioSignature,
  signContentStudioRequest,
} from "@/services/marketing/signature";
import {
  createMarketingUnsubscribeToken,
  verifyMarketingUnsubscribeToken,
} from "@/services/marketing/unsubscribe-token";

const message = {
  campaignKey: "release-2026-08",
  locale: "en" as const,
  subject: "A safer release",
  preheader: "What changed",
  template: {
    accentColor: "#15856f",
    pageBackgroundColor: "#f4f3ee",
    contentBackgroundColor: "#ffffff",
    footerText: "Product news",
    companyAddress: "1 Example Street",
  },
  blocks: [
    { type: "heading" as const, text: "Hello <team>", level: 1 as const, align: "left" as const },
    { type: "button" as const, label: "Read more", url: "https://example.com/release", align: "left" as const },
  ],
};

describe("marketing content contract", () => {
  it("accepts safe structured blocks and rejects header injection", () => {
    expect(MarketingMessageSchema.safeParse(message).success).toBe(true);
    expect(
      MarketingMessageSchema.safeParse({ ...message, subject: "Hello\r\nBcc: x@example.com" })
        .success,
    ).toBe(false);
  });

  it("escapes author text and always renders the compliance footer", () => {
    const rendered = renderMarketingMessage(
      MarketingMessageSchema.parse(message),
      "https://app.example.com/unsubscribe",
    );
    expect(rendered.html).toContain("Hello &lt;team&gt;");
    expect(rendered.html).toContain("1 Example Street");
    expect(rendered.html).toContain("https://app.example.com/unsubscribe");
    expect(rendered.text).toContain("Unsubscribe:");
  });
});

describe("marketing request and unsubscribe signatures", () => {
  beforeEach(() => {
    process.env.CONTENT_MARKETING_SECRET = "g".repeat(32);
    process.env.MARKETING_UNSUBSCRIBE_SECRET = "u".repeat(32);
    resetEnvCacheForTests();
  });

  it("accepts a current exact-body gateway signature and rejects tampering", () => {
    const body = JSON.stringify({ message });
    const now = new Date("2026-08-03T00:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000).toString();
    const signature = signContentStudioRequest(body, timestamp, "g".repeat(32));
    const request = new Request("https://app.example.com/api/internal/marketing/test", {
      method: "POST",
      headers: {
        "x-content-timestamp": timestamp,
        "x-content-signature": signature,
      },
      body,
    });
    expect(() =>
      requireContentStudioSignature(request, body, now),
    ).not.toThrow();
    expect(() =>
      requireContentStudioSignature(request, `${body} `, now),
    ).toThrow();
  });

  it("round-trips a topic-scoped unsubscribe token and rejects edits", () => {
    const token = createMarketingUnsubscribeToken({
      subscriptionUuid: "2aa27ac5-169c-46dc-b675-1c66af7425bf",
      topic: "product-updates",
    });
    expect(verifyMarketingUnsubscribeToken(token)).toEqual({
      version: 1,
      subscriptionUuid: "2aa27ac5-169c-46dc-b675-1c66af7425bf",
      topic: "product-updates",
    });
    expect(verifyMarketingUnsubscribeToken(`${token}x`)).toBeNull();
  });
});
