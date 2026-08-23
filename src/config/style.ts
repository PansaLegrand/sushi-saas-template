/**
 * One build-time visual language for both the customer app and admin console.
 *
 * The customizer writes the selected value to the tracked product config
 * without changing the CSS contract or either root layout.
 */
import { productConfig, productStylePresets } from "@/config/product";

export const stylePresets = productStylePresets;

export type StylePreset = (typeof stylePresets)[number];

export const stylePreset: StylePreset = productConfig.appearance.preset;
