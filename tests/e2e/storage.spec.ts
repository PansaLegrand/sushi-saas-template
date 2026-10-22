import { expect, test } from "@playwright/test";

import {
  E2E_CRON_SECRET,
  E2E_MUTATIONS_ENABLED,
  E2E_WORKER_ENABLED,
} from "./fixtures";

test("uploads and deletes a private object through the real S3 adapter", async ({
  page,
}) => {
  test.skip(
    !E2E_MUTATIONS_ENABLED,
    "Set E2E_ALLOW_MUTATIONS=1 for a disposable external environment.",
  );

  const filename = `playwright-${Date.now()}.txt`;
  await page.goto("/en/account/files");
  await expect(
    page.getByRole("heading", { name: "Workspace files" }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from("private Playwright storage contract\n"),
  });

  const storedRow = page
    .locator("li", {
      has: page.getByRole("button", { name: "Delete" }),
    })
    .filter({ hasText: filename });
  await expect(storedRow).toContainText("active");
  await expect(
    storedRow.getByRole("button", { name: "Download" }),
  ).toBeEnabled();

  const org = new URL(page.url()).searchParams.get("org")!;
  const listing = await page.request.get(
    `/api/storage/files?org=${encodeURIComponent(org)}`,
  );
  expect(listing.ok()).toBe(true);
  const uploaded = (await listing.json()).data.items.find(
    (file: { original_filename: string }) =>
      file.original_filename === filename,
  );
  const download = await page.request.get(
    `/api/storage/files/${uploaded.uuid}?download=1&org=${encodeURIComponent(org)}`,
  );
  expect(download.ok()).toBe(true);
  const signedUrl = (await download.json()).data.downloadUrl as string;
  const bytes = await page.request.get(signedUrl);
  expect(bytes.ok()).toBe(true);
  expect(await bytes.text()).toBe("private Playwright storage contract\n");

  await storedRow.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete file?" });
  await expect(dialog).toContainText(filename);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(storedRow).toHaveCount(0);
  if (E2E_WORKER_ENABLED) {
    await expect.poll(async () => {
      const drain = await page.request.get("/api/cron/jobs", {
        headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
      });
      expect(drain.ok()).toBe(true);
      return (await page.request.get(signedUrl)).status();
    }, { timeout: 20_000, intervals: [100, 300, 1_000] }).toBe(404);
  }
});
