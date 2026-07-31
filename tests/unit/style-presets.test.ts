/**
 * A missing token silently makes one preset inherit another preset's visual
 * language. These checks keep the build-time choice complete and ensure both
 * independently deployed frontends apply it at the document root.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stylePreset, stylePresets } from "@/config/style";

const ROOT = resolve(__dirname, "../..");
const THEME = readFileSync(resolve(ROOT, "src/app/theme.css"), "utf8");

const PALETTE_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "info",
  "info-foreground",
  "rating",
  "border",
  "input",
  "ring",
  "overlay",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

const FOUNDATION_TOKENS = [
  "app-font-sans",
  "app-font-display",
  "app-font-weight-medium",
  "app-font-weight-semibold",
  "app-tracking-tight",
  "app-tracking-wide",
  "style-radius-xs",
  "style-radius-sm",
  "style-radius-md",
  "style-radius-lg",
  "style-radius-xl",
  "style-radius-2xl",
  "style-border-width",
  "surface-backdrop-filter",
  "body-background-image",
  "style-shadow-2xs",
  "style-shadow-xs",
  "style-shadow-sm",
  "style-shadow",
  "style-shadow-md",
  "style-shadow-lg",
  "style-shadow-xl",
  "style-shadow-2xl",
] as const;

function selectorBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = THEME.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));

  expect(match, `missing CSS block for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("style preset contract", () => {
  it("exports five unique presets and a valid build-time selection", () => {
    expect(stylePresets).toHaveLength(5);
    expect(new Set(stylePresets)).toHaveLength(5);
    expect(stylePresets).toContain(stylePreset);
  });

  it("defines every semantic color in light and dark mode", () => {
    for (const preset of stylePresets) {
      for (const selector of [
        `[data-style="${preset}"]`,
        `[data-style="${preset}"].dark`,
      ]) {
        const block = selectorBlock(selector);

        for (const token of PALETTE_TOKENS) {
          expect(block, `${selector} is missing --${token}`).toContain(
            `--${token}:`,
          );
        }
      }
    }
  });

  it("defines typography, geometry, material, and elevation per preset", () => {
    for (const preset of stylePresets) {
      const block = selectorBlock(`[data-style="${preset}"]`);

      for (const token of FOUNDATION_TOKENS) {
        expect(block, `${preset} is missing --${token}`).toContain(
          `--${token}:`,
        );
      }
    }
  });

  it("applies the shared selection to the web and admin document roots", () => {
    for (const file of ["src/app/layout.tsx", "apps/admin/app/layout.tsx"]) {
      const source = readFileSync(resolve(ROOT, file), "utf8");

      expect(source, file).toContain(
        'import { stylePreset } from "@/config/style"',
      );
      expect(source, file).toContain("data-style={stylePreset}");
    }
  });
});
