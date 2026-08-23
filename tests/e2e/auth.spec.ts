import { expect, test } from "@playwright/test";

import { emptyStorageState } from "./fixtures";

test.describe("authentication boundary", () => {
  test.use({ storageState: emptyStorageState() });

  test("redirects an anonymous account request to the localized login", async ({
    page,
  }) => {
    await page.goto("/en/account/files");

    await expect(page).toHaveURL(/\/(?:en\/)?login(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });
});

test("the seeded session reaches the tenant-scoped credits ledger", async ({
  page,
}) => {
  await page.goto("/en/account/credits");

  await expect(page.getByRole("heading", { name: "Credits" })).toBeVisible();
  await expect(page.getByText("Demo User").first()).toBeVisible();
  const balance = page
    .getByText("Spendable balance")
    .locator("..")
    .locator("dd");
  await expect(balance).toHaveText(/\d+/);
  await expect(page.getByText("Manual adjustment").first()).toBeVisible();
});
