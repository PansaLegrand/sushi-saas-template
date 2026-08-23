import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  E2E_CRON_SECRET,
  E2E_MUTATIONS_ENABLED,
  E2E_WORKER_ENABLED,
} from "./fixtures";

async function credits(request: APIRequestContext) {
  const response = await request.post("/api/account/credits", {
    data: { includeLedger: false, includeExpiring: false },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as { balance: number };
}

test("charges five credits once and stores the generated image privately", async ({
  page,
}) => {
  test.skip(
    !E2E_MUTATIONS_ENABLED,
    "Set E2E_ALLOW_MUTATIONS=1 for a disposable external environment.",
  );
  test.skip(
    !E2E_WORKER_ENABLED,
    "Set E2E_CRON_SECRET so the disposable environment can drain its worker.",
  );

  await page.goto("/en/tasks/image-generation");
  await expect(
    page.getByRole("heading", { name: "Image generation" }),
  ).toBeVisible();

  const request = page.request;
  // The seed may have queued signup mail/credits. Drain fixture work before
  // measuring this task so an unrelated +10 grant cannot hide the exact -5.
  const fixtureDrain = await request.get("/api/cron/jobs", {
    headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(fixtureDrain.ok()).toBe(true);
  const before = await credits(request);
  const key = `playwright-image-${Date.now()}`;
  const create = () =>
    request.post("/api/tasks/image-generation", {
      headers: { "Idempotency-Key": key },
      data: {
        prompt: "A tiny sushi boat under a violet moon",
        idempotencyKey: key,
      },
    });

  const first = await create();
  const replay = await create();
  expect(first.status()).toBe(202);
  expect(replay.status()).toBe(202);
  const firstPayload = await first.json();
  const replayPayload = await replay.json();
  expect(replayPayload.data.task.uuid).toBe(firstPayload.data.task.uuid);
  expect(replayPayload.data.replayed).toBe(true);
  expect((await credits(request)).balance).toBe(before.balance - 5);

  const taskUuid = firstPayload.data.task.uuid as string;
  let task = firstPayload.data.task as {
    status: string;
    outputUrl?: string;
    outputFileUuid?: string;
  };

  for (let attempt = 0; attempt < 3 && task.status !== "succeeded"; attempt += 1) {
    const drain = await request.get("/api/cron/jobs", {
      headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
    });
    expect(drain.ok()).toBe(true);

    const current = await request.get(`/api/tasks/${taskUuid}`);
    expect(current.ok()).toBe(true);
    task = (await current.json()).data.task;
  }

  expect(task.status).toBe("succeeded");
  expect(task.outputFileUuid).toBe(taskUuid);
  expect(task.outputUrl).toBeTruthy();
  expect((await credits(request)).balance).toBe(before.balance - 5);

  const image = await request.get(task.outputUrl!);
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toContain("image/svg+xml");
  expect((await image.body()).byteLength).toBeGreaterThan(100);
});
