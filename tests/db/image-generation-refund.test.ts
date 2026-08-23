/**
 * Database tier: terminal image-generation compensation.
 *
 * Service tests mock the ledger and task models, so only real Postgres can
 * prove that five failed provider attempts produce one spend, one refund, and
 * one terminal task even when the handler is replayed afterwards.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { users } from "@/db/schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { asOrgUuid } from "@/models/organization";
import { findTaskByUuid } from "@/models/task";
import {
  CreditsTransType,
  getOrgCreditSummary,
  increaseCredits,
} from "@/services/credit";
import { jobHandlers } from "@/services/jobs/handlers";
import { ensurePersonalOrganization } from "@/services/organizations";
import { createImageGenerationTask } from "@/services/tasks/image-generation";

import { describeDb, useCleanDatabase } from "./setup";

describeDb("image-generation refund (real database)", () => {
  useCleanDatabase();

  let userUuid = "";
  let orgUuid = "";

  beforeEach(async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_IMAGE_GENERATION_MOCK = "true";
    process.env.IMAGE_GENERATION_MOCK_FAILURES = "5";
    resetEnvCacheForTests();

    const userId = randomUUID();
    userUuid = randomUUID();
    const email = `image-refund-${userUuid}@test.dev`;
    await db().insert(users).values({
      id: userId,
      uuid: userUuid,
      email,
      signin_provider: "credential",
    });
    const org = await ensurePersonalOrganization({ id: userId, email });
    orgUuid = org.uuid;
    await increaseCredits({
      org_uuid: orgUuid,
      user_uuid: userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });
  });

  afterEach(() => {
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_IMAGE_GENERATION_MOCK;
    delete process.env.IMAGE_GENERATION_MOCK_FAILURES;
    resetEnvCacheForTests();
  });

  it("refunds one five-credit spend exactly once after terminal failure", async () => {
    const created = await createImageGenerationTask({
      orgUuid: asOrgUuid(orgUuid),
      userUuid,
      prompt: "provider should fail",
      idempotencyKey: `refund-${randomUUID()}`,
    });
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(5);

    const context = {
      jobUuid: created.task.job_uuid!,
      maxAttempts: 8,
      signal: new AbortController().signal,
    };
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(
        jobHandlers.image_generation(
          { taskUuid: created.task.uuid, orgUuid },
          { ...context, attempt },
        ),
      ).rejects.toMatchObject({ code: "TASK_PROVIDER_FAILED" });
    }
    await jobHandlers.image_generation(
      { taskUuid: created.task.uuid, orgUuid },
      { ...context, attempt: 5 },
    );
    // A stale/manual replay observes the terminal state and performs no effect.
    await jobHandlers.image_generation(
      { taskUuid: created.task.uuid, orgUuid },
      { ...context, attempt: 6 },
    );

    const failed = await findTaskByUuid(created.task.uuid, orgUuid);
    expect(failed).toMatchObject({
      status: "failed",
      error_message: "TASK_PROVIDER_FAILED",
    });
    const summary = await getOrgCreditSummary(orgUuid, { includeAudit: true });
    expect(summary.balance).toBe(10);
    expect(
      summary.ledger.filter(
        (entry) => entry.transType === CreditsTransType.TaskImageGeneration,
      ),
    ).toHaveLength(1);
    expect(
      summary.ledger.filter(
        (entry) => entry.transType === CreditsTransType.TaskAdjust,
      ),
    ).toHaveLength(1);
  });
});
