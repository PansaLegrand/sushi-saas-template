/** A generator must never overwrite an adopter's domain or create unguarded routes. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  domainFiles,
  scaffoldDomain,
} from "../../scripts/lib/domain-scaffold.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("rejects traversal and writes only horizontal, disabled source", () => {
  expect(() => domainFiles("../escape")).toThrow();
  const root = mkdtempSync(join(tmpdir(), "sushi-domain-test-"));
  roots.push(root);
  const plan = scaffoldDomain(root, "sample-records", true);
  expect(plan).toHaveLength(8);
  expect(plan.some((path) => path.includes("features/"))).toBe(false);
  const files = scaffoldDomain(root, "sample-records");
  expect(files).toEqual(plan);
  const route = readFileSync(
    join(root, "src/app/api/sample-records/route.ts"),
    "utf8",
  );
  expect(route.indexOf("if (!actor) return respNoAuth()")).toBeLessThan(
    route.indexOf("return respData"),
  );
  expect(
    readFileSync(join(root, "src/config/sample-records.ts"), "utf8"),
  ).toContain("SAMPLE_RECORDS_ENABLED = false");
  expect(
    readFileSync(join(root, "src/models/sample-records.ts"), "utf8"),
  ).toContain('throw new AppError("FEATURE_DISABLED")');
  writeFileSync(join(root, files[0]!), "adopter changes");
  expect(() => scaffoldDomain(root, "sample-records")).toThrow(
    "Refusing to overwrite",
  );
  expect(readFileSync(join(root, files[0]!), "utf8")).toBe("adopter changes");
});
