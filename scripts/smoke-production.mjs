#!/usr/bin/env node
/** Boot the shipped web/admin artifacts in isolation; never inherit provider credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "sushi-production-smoke-"));
let browser;
const children = [];
const secret = () => randomBytes(48).toString("hex");
try {
  browser = await chromium.launch();
  for (const [index, app] of ["web", "admin"].entries()) {
    const appRoot = app === "web" ? root : join(root, "apps/admin");
    const artifact = join(temporary, app);
    await cp(join(appRoot, ".next/standalone"), artifact, {
      recursive: true,
      filter: (path) => !basename(path).startsWith(".env"),
    });
    const runtime = app === "web" ? artifact : join(artifact, "apps/admin");
    await cp(join(appRoot, ".next/static"), join(runtime, ".next/static"), { recursive: true });
    if (app === "web") await cp(join(root, "public"), join(runtime, "public"), { recursive: true });
    const port = 3290 + index;
    const base = `http://localhost:${port}`;
    let logs = "";
    const child = spawn(process.execPath, [join(runtime, "server.js")], {
      cwd: runtime,
      env: {
        PATH: process.env.PATH, NODE_ENV: "production", HOSTNAME: "localhost", PORT: String(port),
        NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_WEB_URL: base, BETTER_AUTH_URL: base,
        NEXT_PUBLIC_AUTH_BASE_URL: base, NEXT_PUBLIC_ADMIN_WEB_URL: base,
        BETTER_AUTH_SECRET: secret(), CRON_SECRET: secret(), NEXT_PUBLIC_CAPTCHA_ENABLED: "false",
        DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:1/sushi_smoke_test",
        RATE_LIMIT_REDIS_URL: "redis://127.0.0.1:1", RATE_LIMIT_IP_SOURCE: "x-forwarded-for",
        STRIPE_PRIVATE_KEY: "sk_test_smoke", STRIPE_WEBHOOK_SECRET: `whsec_${secret()}`,
        STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_smoke",
        STRIPE_PRICE_PLUS_MONTHLY: "price_plusMonthly", STRIPE_PRICE_PLUS_YEARLY: "price_plusYearly",
        STRIPE_PRICE_MAX_MONTHLY: "price_maxMonthly", STRIPE_PRICE_MAX_YEARLY: "price_maxYearly",
        RESEND_API_KEY: "re_smoke", EMAIL_FROM: "Smoke <smoke@example.test>",
        STORAGE_BUCKET: "smoke", STORAGE_REGION: "auto", STORAGE_ACCESS_KEY: "smoke", STORAGE_SECRET_KEY: secret(),
      }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    for (const output of [child.stdout, child.stderr]) output.on("data", (chunk) => { logs = (logs + chunk).slice(-20_000); });
    const path = app === "web" ? "/en/login" : "/login";
    let ready = false;
    let lastProbe = "no response";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${app} exited before readiness:\n${logs}`);
      try {
        const probe = await fetch(base + path, { signal: AbortSignal.timeout(1500) });
        ready = probe.ok;
        lastProbe = `${probe.status} ${probe.url}`;
      } catch (error) { lastProbe = String(error.cause ?? error); }
      if (ready) break;
      await delay(500);
    }
    assert(ready, `${app} did not become ready (${lastProbe}):\n${logs}`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // A smoke test must not load analytics, captcha, or any provider widget.
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(base + path);
    assert(response?.ok(), `${app} login failed`);
    assert(response.headers()["x-content-type-options"] === "nosniff", `${app} security headers missing`);
    await page.locator('input[type="email"]').waitFor();
    const chunks = await page.locator('script[src*="/_next/static/"]').evaluateAll(nodes => nodes.map(node => node.src));
    assert(chunks.length > 0, `${app} has no production chunks`);
    for (const url of chunks) assert((await page.request.get(url)).ok(), `${app} missing chunk`);
    assert.deepEqual(errors, [], `${app} client errors`);
    if (app === "web") {
      const health = await page.request.get(base + "/api/health");
      assert.equal((await health.json()).environment, "production");
      await page.goto(base + "/fr/account/profile");
      await page.waitForURL(/\/login/);
    }
    await context.close();
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    console.log(`${app}: production boot, mobile login, static chunks, headers${app === "web" ? ", health and auth redirect" : ""} passed`);
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
