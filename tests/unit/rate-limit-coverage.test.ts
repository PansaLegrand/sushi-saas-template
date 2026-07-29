import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CRITICAL_MUTATION_ROUTES = [
  "src/app/api/auth/[...all]/route.ts",
  "apps/admin/app/api/auth/[...all]/route.ts",
  "src/app/api/account/password/route.ts",
  "src/app/api/account/credits/grant/route.ts",
  "src/app/api/account/credits/consume/route.ts",
  "src/app/api/account/team/invitations/route.ts",
  "src/app/api/account/team/invitations/[id]/route.ts",
  "src/app/api/account/team/members/[id]/route.ts",
  "src/app/api/billing/portal/route.ts",
  "src/app/api/checkout/route.ts",
  "src/app/api/feedback/route.ts",
  "src/app/api/reservations/route.ts",
  "src/app/api/storage/uploads/route.ts",
  "src/app/api/storage/uploads/complete/route.ts",
  "src/app/api/storage/files/[uuid]/route.ts",
  "src/app/api/tasks/text-to-video/route.ts",
  "apps/admin/app/api/admin/credits/grant/route.ts",
  "apps/admin/app/api/admin/users/[uuid]/plan/route.ts",
  "apps/admin/app/api/admin/users/[uuid]/ban/route.ts",
  "apps/admin/app/api/admin/blocklist/route.ts",
  "apps/admin/app/api/admin/blocklist/[uuid]/route.ts",
] as const;

describe("critical route rate-limit coverage", () => {
  it.each(CRITICAL_MUTATION_ROUTES)("%s keeps a rate-limit guard", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source).toContain("rateLimitOrThrow");
  });

  it("does not throttle the signed Stripe webhook", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/pay/webhook/stripe/route.ts"),
      "utf8"
    );

    expect(source).toContain("Stripe.webhooks.constructEvent");
    expect(source).not.toContain("rateLimitOrThrow");
  });
});
