/** Shared layouts must never restore a previous tenant after client navigation. */
import { expect, test } from "@playwright/test";

import { E2E_MUTATIONS_ENABLED } from "./fixtures";

test("workspace switching, history, and separate tabs keep their own tenant", async ({ page, context }) => {
  test.skip(!E2E_MUTATIONS_ENABLED, "Workspace fixtures require a disposable environment.");

  await page.goto("/en/account/team");
  await expect(page).toHaveURL(/[?&]org=/);
  const firstUrl = page.url();
  const firstSlug = new URL(firstUrl).searchParams.get("org")!;
  const slug = "e2e-workspace-secondary";
  const organizations = await page.request.get("/api/auth/organization/list");
  expect(organizations.ok()).toBe(true);
  const existing = await organizations.json() as { slug: string }[];
  if (!existing.some((org) => org.slug === slug)) {
    const created = await page.request.post("/api/auth/organization/create", {
      headers: { Origin: new URL(page.url()).origin },
      data: { name: "E2E Secondary Workspace", slug },
    });
    expect(created.ok()).toBe(true);
  }

  // Reload once to discover the new membership; the switch itself must work
  // through client navigation without remounting the shared server layout.
  await page.reload();
  const otherTab = await context.newPage();
  await otherTab.goto(firstUrl);
  const selector = page.getByLabel("Switch workspace");
  await selector.selectOption(slug);
  await expect(page).toHaveURL(new RegExp(`org=${slug}`));
  await expect(selector).toHaveValue(slug);
  await expect(page.locator("main")).toContainText("E2E Secondary Workspace");
  await expect(page.getByRole("link", { name: "Files", exact: true })).toHaveAttribute("href", new RegExp(`org=${slug}`));
  await expect(otherTab.getByLabel("Switch workspace")).toHaveValue(firstSlug);

  await page.goBack();
  await expect(selector).toHaveValue(firstSlug);
  await page.goForward();
  await expect(selector).toHaveValue(slug);
  await expect(page.locator("main")).toContainText("E2E Secondary Workspace");
  await otherTab.close();
});
