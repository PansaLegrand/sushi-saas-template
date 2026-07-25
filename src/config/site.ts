import { getAppEnv } from "@/lib/env";

/**
 * The site island.
 *
 * Everything here is *this deployment's* identity — the project name, the links
 * in the header, where "View on GitHub" points. None of it is kit behaviour, and
 * it is deliberately the only place such content is allowed to live. Site
 * content used to be hardcoded into the landing page, which meant every clone of
 * this template shipped someone else's GitHub star count, showcases, and
 * personal email address.
 *
 * If you cloned this kit, this is the one file to edit. `tests/unit/architecture.test.ts`
 * fails the build if site content leaks back into components or pages.
 *
 * Copy that gets translated stays in `messages/*.json` under `landing.*`. This
 * file holds only what is the same in every language: names, URLs, flags.
 */

export type SiteMode = "app" | "site";

export interface SiteLink {
  /** i18n key under `landing.nav`, or a literal label when `external`. */
  label: string;
  href: string;
  external?: boolean;
}

export const SiteData = {
  /**
   * Shown in the header and as the accessible name of the home link. Defaults
   * to the app name from env so a clean checkout picks up your branding without
   * editing code.
   */
  brand: process.env.NEXT_PUBLIC_APP_NAME || "Your SaaS",

  /**
   * Where the source lives. Set to null and the GitHub call to action does not
   * render at all — a private product should not link to a repository.
   */
  repositoryUrl: null as string | null,

  /**
   * Reachable contact address. Null renders no contact link. Never hardcode a
   * personal address here as a default: it ships to everyone who clones the kit.
   */
  contactEmail: null as string | null,

  /**
   * Header navigation. Docs are part of the kit and always present; add your
   * own entries here rather than editing the landing page.
   */
  nav: [{ label: "docs", href: "/docs" }] as SiteLink[],

  /**
   * Projects built with the kit, rendered as a showcase strip. Empty by default
   * — an empty array renders no section, so a clean checkout has no dead space.
   */
  showcases: [] as Array<{ name: string; url: string; description: string }>,
} as const;

/**
 * Runtime configuration, combining the static values above with the mode switch.
 * A single import so callers never reach for `process.env` themselves — the same
 * shape as `ReservationsConfig`.
 */
export const SiteConfig = {
  ...SiteData,

  get mode(): SiteMode {
    return getAppEnv().NEXT_PUBLIC_SITE_MODE;
  },

  /**
   * True when this deployment is the project's own marketing and docs site.
   * Such a deployment has no database, so every signed-in surface is off.
   */
  get isSiteOnly(): boolean {
    return this.mode === "site";
  },
} as const;
