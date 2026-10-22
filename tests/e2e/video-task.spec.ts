/** The video example must use durable work and preserve its purchase on reload. */
import { expect, test } from "@playwright/test";
import {
  E2E_CRON_SECRET,
  E2E_MUTATIONS_ENABLED,
  E2E_VIDEO_ENABLED,
  E2E_WORKER_ENABLED,
} from "./fixtures";

test("video generation queues once, completes through the worker, and survives reload", async ({
  page,
}) => {
  test.skip(
    !E2E_MUTATIONS_ENABLED || !E2E_WORKER_ENABLED || !E2E_VIDEO_ENABLED,
    "Requires a disposable paid-example fixture and mock video provider.",
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
      new URL(request.url()).pathname === "/api/tasks/text-to-video"
    )
      submissions += 1;
  });
  await page.goto(`/en/tasks/text-to-video?org=${encodeURIComponent(org)}`);
  await page.getByRole("textbox").fill(`Video recovery ${Date.now()}`);
  await page.getByRole("button", { name: "Generate video", exact: true }).click();
  await expect(page).toHaveURL(/[?&]task=/);
  const uuid = new URL(page.url()).searchParams.get("task")!;
  await page.reload();
  await expect
    .poll(async () => {
      await page.request.get("/api/cron/jobs", {
        headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
      });
      const response = await page.request.get(
        `/api/tasks/${uuid}?org=${encodeURIComponent(org)}`,
      );
      return (await response.json()).data.task.status;
    })
    .toBe("succeeded");
  await expect(page.getByText("Video ready", { exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", "/demo-video.mp4");
  expect((await page.request.get("/demo-video.mp4")).ok()).toBe(true);
  expect(submissions).toBe(1);
  expect(await balance()).toBe(before - 8);
});
