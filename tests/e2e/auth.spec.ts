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
  // External disposable fixtures may have any display name. The contract is
  // that the page uses the selected workspace, not the default seed's label.
  const selected = page.getByLabel("Switch workspace").locator("option:checked");
  const workspace = (await selected.innerText()).split(" · ")[0];
  await expect(page.getByRole("main")).toContainText(workspace);
  const balance = page
    .getByText("Spendable balance")
    .locator("..")
    .locator("dd");
  await expect(balance).toHaveText(/\d+/);
  await expect(page.getByRole("table", { name: "Workspace credit history" })).toBeVisible();
});

test("credit history pages retain workspace context and the full balance", async ({
  page,
}) => {
  await page.goto("/en/account/credits");
  await expect(page).toHaveURL(/[?&]org=/);
  const url = new URL(page.url());
  const balance = () =>
    page
      .getByText("Spendable balance", { exact: true })
      .locator("..")
      .locator("dd");
  const before = await balance().innerText();
  url.searchParams.set("page", "2");
  await page.goto(url.toString());
  await expect(balance()).toHaveText(before);
  const previous = page.getByRole("link", { name: "Previous", exact: true });
  await expect(previous).toHaveAttribute(
    "href",
    new RegExp(`org=${url.searchParams.get("org")}`),
  );
  await previous.click();
  await expect(page).toHaveURL(/[?&]page=1/);
  await expect(balance()).toHaveText(before);
});
