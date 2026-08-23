import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { E2E_USER } from "./fixtures";

const authFile = resolve(".playwright/auth/demo-user.json");

setup("authenticate the seeded demo account", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page
    .locator("form")
    .getByRole("button", { name: "Log in", exact: true })
    .click();

  await expect(page).toHaveURL(/\/(?:en\/)?account\/billing(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();

  await mkdir(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
