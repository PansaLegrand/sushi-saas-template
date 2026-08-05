import { describe, expect, it } from "vitest";
import { jobOwnerIdentity, sanitizedJobLog } from "@/content-api/job-status";

describe("automation job status", () => {
  it("reads the submitting identity from a queued import", () => {
    expect(
      jobOwnerIdentity({
        identity: "service-accounts:7",
        items: [{ title: "private draft input" }]
      })
    ).toBe("service-accounts:7");
    expect(jobOwnerIdentity({ items: [] })).toBeNull();
  });

  it("does not return stored inputs or provider error details", () => {
    const [entry] = sanitizedJobLog([
      {
        executedAt: "2026-08-02T00:00:00.000Z",
        taskSlug: "importContent",
        state: "failed",
        input: { items: [{ body: "unpublished content" }] },
        output: { results: [{ ok: false, error: "CREATE_FAILED" }] },
        error: { message: "database credentials appeared here" }
      }
    ]);

    expect(entry).not.toHaveProperty("input");
    expect(entry.error).toBe("TASK_FAILED");
    expect(JSON.stringify(entry)).not.toContain("credentials");
  });
});
