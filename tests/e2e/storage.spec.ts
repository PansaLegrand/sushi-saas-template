import { expect, test } from "@playwright/test";

import { E2E_MUTATIONS_ENABLED } from "./fixtures";

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

  await storedRow.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete file?" });
  await expect(dialog).toContainText(filename);
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(storedRow).toHaveCount(0);
});
