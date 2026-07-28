"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface QrCodeProps {
  /** The text to encode. For TOTP this is the whole `otpauth://` URI. */
  value: string;
  /** Rendered size in CSS pixels. The SVG scales, so this is a hint, not a raster size. */
  size?: number;
  /** Accessible name. A QR is an image of text, and screen readers get nothing from the pixels. */
  label?: string;
  className?: string;
}

/**
 * A QR code, rendered as inline SVG.
 *
 * **Inline SVG rather than an `<img>` with a data URI**, and that is a
 * constraint rather than a preference: `img-src` in `src/config/security-headers.js`
 * is `'self' https:` with no `data:`, so a generated data-URI image is blocked
 * by CSP in production while working fine in a dev build with headers off —
 * the worst kind of bug to find. Inline SVG is ordinary DOM and needs no
 * directive at all.
 *
 * Drawn with `currentColor` so it inherits the surrounding text colour and
 * survives a dark theme. A QR needs contrast, not specific colours — but it
 * does need a light *quiet zone* around it, which is why the background rect
 * is always painted rather than left transparent.
 */
export function QrCode({ value, size = 200, label, className }: QrCodeProps) {
  const { path, dimension } = useMemo(() => {
    // Type 0 = auto-size to the content. "M" corrects ~15% damage, the level
    // authenticator apps expect and what every TOTP setup page uses.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    // Four modules of quiet zone on each side. Below that, scanners struggle to
    // find the symbol against the page — it is part of the spec, not padding.
    const quietZone = 4;
    const total = count + quietZone * 2;

    // One path for the whole symbol rather than a rect per module: a 37×37 code
    // is ~1400 elements, and React reconciling that on every render is real
    // jank for something that never changes.
    const parts: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          parts.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
        }
      }
    }

    return { path: parts.join(""), dimension: total };
  }, [value]);

  return (
    <svg
      // The viewBox is in module units, so the path above is written in whole
      // numbers and the browser does the scaling.
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label ?? "QR code"}
      shapeRendering="crispEdges"
    >
      {/* Always white, never the theme background: a scanner needs light
          modules to be light, and a dark-theme card behind a transparent QR
          inverts the contrast and stops it scanning. */}
      <rect width={dimension} height={dimension} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export default QrCode;
