/**
 * Turnstile's normal iframe is wider than a small phone's padded auth card.
 * These boundaries prevent a future styling refactor from reintroducing
 * horizontal overflow in the only environment where CAPTCHA is mandatory.
 */
import { describe, expect, it } from "vitest";

import { turnstileSizeForWidth } from "@/lib/turnstile-size";

describe("turnstileSizeForWidth", () => {
  it("uses compact below Cloudflare's 300px normal-widget width", () => {
    expect(turnstileSizeForWidth(224)).toBe("compact");
    expect(turnstileSizeForWidth(299)).toBe("compact");
  });

  it("uses the normal widget when the full width is available", () => {
    expect(turnstileSizeForWidth(300)).toBe("normal");
    expect(turnstileSizeForWidth(384)).toBe("normal");
  });
});
