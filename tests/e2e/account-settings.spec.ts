/** Account controls must work through real auth, scoped services, and accessible dialogs. */
import { expect, test } from "@playwright/test";
import { E2E_MUTATIONS_ENABLED, E2E_USER } from "./fixtures";

test("profile, redacted sessions, and privacy ownership guidance survive reload", async ({ page }) => {
  test.skip(!E2E_MUTATIONS_ENABLED, "Requires a disposable account.");
  await page.goto("/en/account/profile");
  const name = page.getByLabel("Display name");
  await expect(name).toBeVisible();
  const original = await name.inputValue();
  const revised = `${original.replace(/ updated$/, "")} updated`;
  await name.fill(revised);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile updated" })).toBeVisible();
  await page.reload(); await expect(name).toHaveValue(revised);
  await name.fill(original);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const response = await page.request.get("/api/account/settings");
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.data.sessions.length).toBeGreaterThan(0);
  for (const session of payload.data.sessions) {
    expect(session.reference).toMatch(/^[a-f0-9]{64}$/);
    expect(session).not.toHaveProperty("token");
    expect(session).not.toHaveProperty("id");
  }
  expect((await page.request.get("/api/auth/list-sessions")).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/account/privacy");
  await expect(page.getByRole("button", { name: "Create export" })).toBeVisible();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Schedule deletion" })).toBeDisabled();
  await dialog.getByRole("textbox").fill(E2E_USER.email);
  await expect(dialog.getByRole("button", { name: "Schedule deletion" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
