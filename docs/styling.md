# Visual style presets

The application and admin console share one visual-style contract. The web
root imports `src/app/globals.css`; the admin root imports that same stylesheet
from `apps/admin/app/globals.css`. Both document roots render the preset as a
`data-style` attribute, while the existing `.dark` class remains exclusively
responsible for color mode.

## Audit result

The July 2026 audit found a strong semantic-token foundation:

- The application and admin UI contain well over 600 semantic color utility
  usages.
- Named shadows already resolve through the global Tailwind shadow variables.
- `rounded-sm` through `rounded-xl` already used theme variables.
- The admin already consumed the application's global stylesheet.

The audit also found four gaps that prevented a true whole-stack switch:

1. Named Tailwind colors were used for success, warning, info, ratings, and the
   dialog overlay.
2. Bare `rounded`, ordinary borders, directional borders, and dividers compiled
   to fixed pixel values.
3. The body did not consume the configured font stack, and display type had no
   separate role.
4. Translucent colors alone could not produce glass because semantic surfaces
   had no shared backdrop-filter hook.

The preset contract now closes those gaps. An architecture test prevents named
palette utilities from returning to application UI.

## Included presets

| ID          | Intent                                                              | Geometry and material                                                                         |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `studio`    | Balanced product default with cool neutrals and a blue action color | Moderate radius, 1px rules, opaque surfaces, quiet diffuse shadows                            |
| `glass`     | Edgy violet/cyan aurora glass                                       | Large radius, translucent surfaces, 20px blur, ambient gradients, luminous elevation          |
| `soft`      | Friendly, warm, low-pressure product UI                             | Generous radius, coral and mint color, soft ambient backgrounds, broad low-contrast shadows   |
| `editorial` | Traditional premium paper-and-ink treatment                         | Serif display type, oxblood action color, very small radius, warm rules, restrained elevation |
| `brutalist` | Bold graphic treatment and the square option                        | Zero surface radius, 2px rules, loud color blocks, hard offset shadows                        |

Every preset defines a complete semantic palette for both light and dark mode.
Admin currently has no theme-mode provider, so it renders the selected preset in
light mode; its dark values are ready for a later admin theme-mode decision.

## Selecting the build-time style

Change the single typed constant in `src/config/style.ts`:

```ts
export const stylePreset: StylePreset = "glass";
```

The server renders that value onto both `<html>` elements, so there is no
client-side flash and Radix portals inherit the same preset. There is
intentionally no runtime picker or persisted user preference yet. A future
starter configurator should write this constant rather than introduce a second
selection path.

## Token contract

Preset values live in `src/app/theme.css` and cover:

- Semantic canvas, content, card, popover, action, muted, status, chart, and
  sidebar colors.
- Body, display, serif, and monospace font stacks; common weight and tracking
  roles.
- Independent radius roles from `xs` through `2xl`.
- Default border/divider width.
- Semantic surface backdrop filtering and the body background image.
- Elevation from `2xs` through `2xl`.

`src/app/globals.css` maps those values to Tailwind v4. In particular,
`--default-border-width` makes existing `border`, directional border, and
divider utilities respond to a preset, and the bare `--radius` mapping makes
plain `rounded` respond as well. Explicit geometry such as `border-2`,
`rounded-none`, and `rounded-full` remains intentional component behavior.

The `bg-background`, `bg-card`, and `bg-popover` utilities also apply the
semantic material hook. It resolves to `none` for opaque presets and to a
backdrop filter for `glass`. DayPicker is a vendor-owned exception; the admin
stylesheet bridges its public radius and border variables after importing the
vendor CSS.

## Deliberate boundaries

These surfaces do not follow the normal preset stylesheet:

- Root `global-error.tsx` boundaries must render even when the root layout or
  stylesheet failed, so they retain standalone fallback styles.
- Email HTML must use inline, broadly supported email-client CSS.
- QR modules stay pure black on white for scanner reliability.
- Third-party brand artwork and embedded widgets retain their required brand or
  provider styling.

## Adding or changing a preset

1. Add the ID to `stylePresets` in `src/config/style.ts`.
2. Add matching light and `.dark` blocks in `src/app/theme.css`.
3. Define every palette and foundation token checked by
   `tests/unit/style-presets.test.ts`.
4. Use semantic UI colors; the architecture test rejects named Tailwind
   palettes in application and admin UI.
5. Check representative web and admin screens, including focus, disabled,
   warning, success, dialog, table, and mobile-navigation states.
6. Run `pnpm lint`, `pnpm test:run`, `pnpm build:web`, and
   `pnpm build:admin`.
