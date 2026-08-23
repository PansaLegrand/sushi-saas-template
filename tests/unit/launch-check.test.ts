import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../scripts/launch-check.mjs"),
  "utf8",
);

describe("launch readiness command", () => {
  it("contains only read-only database and deployment checks", () => {
    expect(source).toContain('"scripts/migrate.mjs", "--check"');
    expect(source).toContain('"db:integrity"');
    expect(source).toContain('"retention:report"');
    expect(source).toContain('"containers:check"');

    expect(source).not.toContain('"db:migrate:prod"');
    expect(source).not.toContain('"retention:apply"');
    expect(source).not.toContain('"db:restore:drill"');
    expect(source).not.toContain('"up", "-d"');
  });
});
