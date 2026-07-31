# Frontend system

The frontend has four layers. A page may compose the layer below it; it should
not recreate that layer's styling or behavior.

```text
visual tokens → UI primitives → reusable patterns → domain pages
```

This document is the engineering contract for both the customer application and
the admin console. Visual preset details live in `docs/styling.md`.

## 1. Visual tokens

`src/app/theme.css` owns the decisions that should change when a project selects
another visual preset:

- semantic colors;
- font families and common weights;
- radius roles;
- border width;
- surface material and backdrop filtering;
- elevation.

Components consume semantic utilities such as `bg-card`, `text-foreground`,
`text-success`, and `border-border`. They must not use named palettes such as
`blue-500`, inspect `stylePreset`, or branch on `data-style`.

Do not turn every margin or responsive width into a token. Tailwind's spacing
scale remains appropriate for local layout. A value becomes a token when it is
a repeated system decision that should move across every frontend.

## 2. UI primitives

`src/components/ui/` owns interaction, accessibility, and ergonomic sizing:

- `Button`
- `Input`, `Select`, and `Textarea`
- `Field`
- `Alert`
- `Card`
- `Dialog` and `Popover`
- `Table`
- `Skeleton` and `EmptyState`

Normal controls use the comfortable defaults: 40px for standard controls and
44px for prominent authentication controls. Dense toolbars may opt into an
explicit `compact` size or density. Compact is never the page-wide default.

Use `Field` for a visible label, description, invalid state, and associated
error. Placeholder text is an example, not a label.

Component variants describe purpose:

```tsx
<Button variant="destructive">Suspend account</Button>
<Alert variant="warning">Cancellation is scheduled.</Alert>
<Input density="compact" />
```

Variants must not describe a preset's appearance:

```tsx
// Avoid
<Button className="bg-red-600 rounded-xl">Suspend account</Button>
```

Native hidden, checkbox, file, and provider-owned inputs may remain raw when a
shared primitive would make their platform behavior worse. Ordinary text
inputs, selects, textareas, and buttons use the shared primitives.

## 3. Reusable patterns

Patterns assemble primitives into a repeatable page-level contract without
owning business logic.

The admin console provides:

- `AdminPageHeader`
- `AdminToolbar`
- `AdminPanel`
- `AdminTable`
- `AdminTabs`
- `AdminHelp`
- `AdminStatusBadge`
- `Pager`

A pattern should be added after the third real repetition. Before that, keep the
composition local. This prevents a generic component with dozens of props that
fits no page well.

Admin tables use comfortable rows by default, keep technical identifiers at
least 14px, align numeric columns, and put secondary payloads behind a detail
view when they are not required for the operator's decision.

## 4. Domain components and pages

Domain components own product behavior and compose primitives. Pages own data
loading and broad layout.

Pages may decide:

- which sections appear;
- responsive grid structure;
- the data and actions supplied to a pattern;
- which columns are important for the workflow.

Pages should not decide:

- control heights;
- focus and invalid behavior;
- status colors;
- table cell padding;
- card chrome;
- modal focus management.

Server Components call services directly. Client Components call `src/api/`
wrappers. Presentation components never import models or database code.

## Admin information design

The admin console is an operational product, not a compressed database viewer.

- Lead with the action or decision an operator came to make.
- Use at least 14px for body, table, and operational data.
- Reserve `text-xs` for genuinely secondary metadata.
- Do not render operational content at 10px or 11px.
- Group search, filters, totals, and actions into one toolbar.
- Give sections different visual weight; do not stack every fact in an equal
  bordered box.
- Put long explanations in `AdminHelp` or a runbook link.
- Prefer a focused table with row detail over ten always-visible columns.
- Use link-based tabs for long resource details so every section has a
  shareable URL.

## Review checklist

Before merging frontend work:

1. Does an existing primitive or pattern already own this behavior?
2. Are all colors semantic?
3. Are controls comfortable by default and compact only by intent?
4. Are labels visible and errors associated with their fields?
5. Does the page have one clear title, primary action, and content hierarchy?
6. Are loading, empty, error, disabled, and focus states handled?
7. Does it remain usable on a narrow viewport and with keyboard navigation?
8. Was a representative page checked against every visual preset affected by
   the change?

Architecture tests enforce token use, preset completeness, and the mechanically
detectable parts of primitive adoption. Component tests cover behavior users can
notice. Visual density and hierarchy still require browser review.
