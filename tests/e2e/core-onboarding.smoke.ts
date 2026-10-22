/** A new Core adopter must reach a private result through the real background worker. */
import { expect, test, type APIRequestContext } from "@playwright/test";

import type { CreditSummary } from "../../src/types/credit";
import type {
  CreateImageGenerationResponse,
  TaskRecord,
} from "../../src/types/task";

async function creditSummary(request: APIRequestContext, org: string) {
  const response = await request.post("/api/account/credits", {
    headers: { "x-organization-slug": org },
    data: { includeLedger: true, includeExpiring: false, ledgerLimit: 100 },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).data as CreditSummary;
}

test("Core login, demo credits, durable image, and private output work from a fresh setup", async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("demo@example.test");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page
    .locator("form")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(?:en\/)?account\/billing(?:\?|$)/);
  await expect(page).toHaveURL(/[?&]org=/);
  const org = new URL(page.url()).searchParams.get("org")!;

  // The separate worker also settles signup credits. Wait for them before the
  // balance comparison; never drain /api/cron/jobs to make a missing worker pass.
  await expect
    .poll(async () => {
      const summary = await creditSummary(page.request, org);
      return summary.ledger.filter((row) => row.transType === "new_user")
        .length;
    })
    .toBe(1);
  const before = await creditSummary(page.request, org);
  const seedGrants = before.ledger.filter((row) =>
    row.transNo.startsWith("dev-seed:"),
  );
  expect(seedGrants).toHaveLength(1);
  expect(seedGrants[0].credits).toBe(1_000);
  expect(before.ledger.filter((row) => row.credits < 0)).toHaveLength(0);
  expect(before.balance).toBe(
    before.ledger.reduce((sum, row) => sum + row.credits, 0),
  );

  await page.goto(`/en/account/credits?org=${encodeURIComponent(org)}`);
  await expect(
    page.getByRole("table", { name: "Workspace credit history" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Spendable balance", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText(String(before.balance));

  let browserSubmissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/tasks/image-generation"
    )
      browserSubmissions += 1;
  });
  await page.goto(`/en/tasks/image-generation?org=${encodeURIComponent(org)}`);
  await expect(
    page.getByRole("heading", { name: "Image generation" }),
  ).toBeVisible();
  const prompt = "My first local Core image";
  await page.getByRole("textbox", { name: "Prompt" }).fill(prompt);
  const creationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/tasks/image-generation",
  );
  await page
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  const response = await creationResponse;
  expect(response.status()).toBe(202);
  const created = (await response.json()).data as CreateImageGenerationResponse;
  const originalRequest = response.request().postDataJSON() as {
    prompt: string;
    idempotencyKey: string;
  };
  expect(created.task.creditsUsed).toBe(5);
  expect(created.task.jobUuid).toBeTruthy();
  expect(created.task.creditsTransNo).toBeTruthy();
  await expect(page).toHaveURL(
    new RegExp(`[?&]task=${created.task.uuid}(?:&|$)`),
  );

  const replay = await page.request.post("/api/tasks/image-generation", {
    headers: {
      "x-organization-slug": org,
      "Idempotency-Key": originalRequest.idempotencyKey,
    },
    data: originalRequest,
  });
  expect([200, 202]).toContain(replay.status());
  const replayed = (await replay.json()).data as CreateImageGenerationResponse;
  expect(replayed.replayed).toBe(true);
  expect(replayed.task.uuid).toBe(created.task.uuid);

  const taskPath = `/api/tasks/${created.task.uuid}?org=${encodeURIComponent(org)}`;
  let completed: TaskRecord = created.task;
  await expect
    .poll(async () => {
      const result = await page.request.get(taskPath);
      expect(result.ok()).toBe(true);
      completed = (await result.json()).data.task as TaskRecord;
      return completed.status;
    })
    .toBe("succeeded");
  expect(completed.outputFileUuid).toBe(created.task.uuid);
  expect(completed.outputUrl).toBeTruthy();
  await expect(page.getByText("Image ready", { exact: true })).toBeVisible();

  const signedUrl = new URL(completed.outputUrl!);
  expect(signedUrl.origin).toBe("http://localhost:3900");
  expect(signedUrl.searchParams.has("X-Amz-Signature")).toBe(true);
  const image = await page.request.get(signedUrl.toString());
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/svg+xml");
  expect(await image.text()).toContain(prompt);

  // A signed URL is a bearer grant; without its signature the object must stay
  // private. An anonymous visitor must not obtain another signed URL from SaaS.
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    const unsignedUrl = new URL(signedUrl);
    unsignedUrl.search = "";
    const unsigned = await anonymous.get(unsignedUrl.toString());
    expect([401, 403]).toContain(unsigned.status());
    expect((await anonymous.get(taskPath)).status()).toBe(401);
    const filePath = `/api/storage/files/${completed.outputFileUuid}?download=1&org=${encodeURIComponent(org)}`;
    expect((await anonymous.get(filePath)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveValue(
    prompt,
  );
  await expect(
    page.getByRole("img", { name: "Generated result" }),
  ).toBeVisible();
  expect(browserSubmissions).toBe(1);
  const after = await creditSummary(page.request, org);
  expect(after.balance).toBe(before.balance - 5);
  const debits = after.ledger.filter(
    (row) => row.transType === "task_image_generation",
  );
  expect(debits).toHaveLength(1);
  expect(debits[0]).toMatchObject({
    transNo: created.task.creditsTransNo,
    credits: -5,
  });
  await page.screenshot({
    path: testInfo.outputPath("first-image.png"),
    fullPage: true,
  });
});
