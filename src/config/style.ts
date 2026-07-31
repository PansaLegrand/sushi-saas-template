/**
 * One build-time visual language for both the customer app and admin console.
 *
 * Keep this as a static value for now. A future starter/configurator can write
 * the selected value without changing the CSS contract or either root layout.
 */
export const stylePresets = [
  "studio",
  "glass",
  "soft",
  "editorial",
  "brutalist",
] as const;

export type StylePreset = (typeof stylePresets)[number];

export const stylePreset: StylePreset = "studio";
