/** Reload recovery must read the original paid task, never submit another. */
import { expect, test } from "@playwright/test";
import {
  E2E_CRON_SECRET,
  E2E_MUTATIONS_ENABLED,
  E2E_WORKER_ENABLED,
} from "./fixtures";

test("a paid task survives reload with one submission and one debit", async ({
  page,
}) => {
  test.skip(
    !E2E_MUTATIONS_ENABLED || !E2E_WORKER_ENABLED,
    "Requires a disposable environment with a worker.",
  );
  await page.goto("/en/account/billing");
  await expect(page).toHaveURL(/[?&]org=/);
  const org = new URL(page.url()).searchParams.get("org")!;
  const balance = async () => {
    const response = await page.request.post("/api/account/credits", {
      headers: { "x-organization-slug": org },
      data: { includeLedger: false },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).data.balance as number;
  };
  await page.request.get("/api/cron/jobs", {
    headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  const before = await balance();
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/tasks/image-generation"
    )
      submissions += 1;
  });
  await page.goto(`/en/tasks/image-generation?org=${encodeURIComponent(org)}`);
  const prompt = `Reload-safe task ${Date.now()}`;
  await page.getByRole("textbox", { name: "Prompt" }).fill(prompt);
  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page).toHaveURL(/[?&]task=/);
  const taskUuid = new URL(page.url()).searchParams.get("task")!;
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(
    prompt,
  );
  expect(submissions).toBe(1);
  expect(await balance()).toBe(before - 5);
  await expect
    .poll(async () => {
      await page.request.get("/api/cron/jobs", {
        headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
      });
      const response = await page.request.get(
        `/api/tasks/${taskUuid}?org=${encodeURIComponent(org)}`,
      );
      return (await response.json()).data.task.status;
    })
    .toBe("succeeded");
  await expect(page.getByText("Image ready", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Generated result" }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  expect(await balance()).toBe(before - 5);
});
