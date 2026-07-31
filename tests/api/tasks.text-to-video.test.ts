/**
 * Integration tests for the text-to-video task API.
 *
 * The route is a demo/mock provider surface. It must be disabled by default so
 * production clones do not expose credit-consuming playground behavior.
 *
 * It is also the worked example of a plan gate: generating video costs a
 * provider call, so it is entitled to Plus and above and metered per month.
 * The subscription *model* is mocked rather than the entitlement service, so
 * these tests exercise the real resolution rules — a route that forgot to call
 * `requireEntitlement` would still fail here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";

vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn().mockResolvedValue("u-test"),
}));

// The routes resolve their tenant through `getOrgContext`, which pulls in the
// real Better Auth instance (and therefore a real database) if left unmocked.
vi.mock("@/services/authz", () => ({
  getOrgContext: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  getOrgContextFromHeaders: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  can: () => true,
}));


const listSubscriptionsByOrg = vi.fn();
const countTasksByOrgSince = vi.fn();

vi.mock("@/models/subscription", async () => {
  const actual = await vi.importActual<typeof import("@/models/subscription")>(
    "@/models/subscription"
  );
  return {
    ...actual,
    listSubscriptionsByOrg: (...args: unknown[]) =>
      listSubscriptionsByOrg(...args),
  };
});

vi.mock("@/models/organization", async () => {
  const actual = await vi.importActual<typeof import("@/models/organization")>(
    "@/models/organization",
  );
  return {
    ...actual,
    findOrganizationMemberLimitOverride: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/models/task", () => ({
  countTasksByOrgSince: (...args: unknown[]) => countTasksByOrgSince(...args),
}));

/** An active subscription row on `tier`, enough for the entitlement service. */
function subscriptionOn(tier: string) {
  const now = new Date();
  return {
    uuid: `sub-${tier}`,
    user_uuid: "u-test",
    tier,
    status: "active",
    source: "stripe",
    current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancel_at_period_end: false,
    ended_at: null,
    updated_at: now,
  };
}

/** Enables the demo provider these tests need. */
function enableDemoProvider() {
  process.env.ENABLE_DEMO_FEATURES = "true";
  process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
  resetEnvCacheForTests();
}

vi.mock("@/services/tasks", () => ({
  createTextToVideoTask: vi.fn().mockResolvedValue({
    task: {
      uuid: "task-test",
      user_uuid: "u-test",
      type: "text_to_video",
      status: "succeeded",
      credits_used: 8,
      credits_trans_no: "credit-trans-test",
      user_input: JSON.stringify({ prompt: "hello", seconds: 8 }),
      output_url: "/test.mp4",
      output_json: null,
      error_message: null,
      started_at: new Date("2026-01-01T00:00:00.000Z"),
      completed_at: new Date("2026-01-01T00:00:01.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:01.000Z"),
    },
  }),
}));

import { POST as createTextToVideo } from "@/app/api/tasks/text-to-video/route";

describe("POST /api/tasks/text-to-video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_TEXT2VIDEO_MOCK;
    resetEnvCacheForTests();
    resetRateLimitForTests();
    // Entitled and under quota unless a test says otherwise, so the cases
    // below stay about the behaviour they are named for.
    listSubscriptionsByOrg.mockResolvedValue([subscriptionOn("plus")]);
    countTasksByOrgSince.mockResolvedValue(0);
  });

  it("rejects requests when the demo provider is disabled", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    const res = await createTextToVideo(req);
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(404);
    expect(tasks.createTextToVideoTask).not.toHaveBeenCalled();
  });

  it("creates a demo task when the mock provider is explicitly enabled", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
    resetEnvCacheForTests();

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello", seconds: 8 }),
    });

    const res = await createTextToVideo(req);
    const payload = await res.json();
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data.task.uuid).toBe("task-test");
    expect(tasks.createTextToVideoTask).toHaveBeenCalledWith({
      orgUuid: "org-test",
      userUuid: "u-test",
      input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
      idempotencyKey: undefined,
    });
  });

  it("passes an explicit idempotency key to the task service", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
    resetEnvCacheForTests();

    const req = new Request("http://test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-header-test",
      },
      body: JSON.stringify({ prompt: "hello", seconds: 8 }),
    });

    const res = await createTextToVideo(req);
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(200);
    expect(tasks.createTextToVideoTask).toHaveBeenCalledWith({
      orgUuid: "org-test",
      userUuid: "u-test",
      input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
      idempotencyKey: "idem-header-test",
    });
  });

  it("refuses a free account and names the tier that would work", async () => {
    enableDemoProvider();
    listSubscriptionsByOrg.mockResolvedValue([]);

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    const res = await createTextToVideo(req);
    const payload = await res.json();
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(403);
    expect(payload.error_code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(payload.details).toMatchObject({ tier: "free", requiredTier: "plus" });
    // The gate runs before anything is created or spent.
    expect(tasks.createTextToVideoTask).not.toHaveBeenCalled();
  });

  it("refuses an entitled account that has used its monthly allowance", async () => {
    enableDemoProvider();
    countTasksByOrgSince.mockResolvedValue(50); // Plus allows 50 per month.

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    const res = await createTextToVideo(req);
    const payload = await res.json();
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(403);
    // A different code from the one above on purpose: "upgrade to use this" and
    // "you have used this month's allowance" need different copy and different
    // buttons.
    expect(payload.error_code).toBe("PLAN_LIMIT_EXCEEDED");
    expect(payload.details).toMatchObject({ limit: "tasks.perMonth", max: 50 });
    expect(tasks.createTextToVideoTask).not.toHaveBeenCalled();
  });

  it("lets an unlimited tier past the quota check", async () => {
    enableDemoProvider();
    listSubscriptionsByOrg.mockResolvedValue([subscriptionOn("max")]);
    countTasksByOrgSince.mockResolvedValue(10_000);

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect((await createTextToVideo(req)).status).toBe(200);
  });
});
