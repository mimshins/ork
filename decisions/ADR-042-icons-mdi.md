# ADR-042 — The UI's icons come from Material Design Icons

- **Status:** Accepted
- **Date:** 2026-11-02
- **Topic:** UI / dependencies
- **RFC:** waived. The author chose this directly: "for icons lib, we can go
  with mdi (material-design-icons)".
- **Builds on:** [ADR-040](./ADR-040-ui-stack.md) (the UI's stack)

## Context

The base components started with a dozen icons drawn by hand. The panels still
to come need many more: node types, panel controls, notifications. Drawing each
one, and keeping them consistent, is work that doesn't help Ork's users.

## Decision

The UI's icons come from
[Material Design Icons](https://pictogrammers.com/library/mdi/), through
**`@mdi/js`** (7.4.47), under the Pictogrammers Free License: free for any use,
with the icons under Apache 2.0 or their own licenses.

- **How they are used.** `@mdi/js` exports each icon as an SVG path string.
  [icons.tsx](../packages/ui/src/components/icons.tsx) draws one in the current
  text color at the font's size, and names it for what it means here
  (`IconPaused`), so a component never imports from `@mdi/js` directly.
- **What ships.** Only the icons imported, because the bundler drops the rest,
  and no icon font, so the page's policy needs no change. The license is in
  `dist/ui/THIRD_PARTY_LICENSES.txt`, with the other bundled packages'.
- **Status icons** keep the rule that each status color has its own shape; a
  test checks it.

## Options considered

- **Keep drawing them in-house:** no dependency, but every new icon is design
  work, and the set drifts.
- **`@mdi/react`:** a component around the same paths, with props Ork doesn't
  use. Our own small component does the same.
- **`@mdi/font`:** an icon font loads every icon, and its glyphs need a
  stylesheet and text in the page.
- **Another set (Lucide, Phosphor):** the author chose MDI.

## Rationale

- **A large set with one drawing style,** so the panels to come don't each need
  new icons drawn.
- **Paths, not components or fonts:** no new runtime code, and nothing to load.

## Consequences

- **A dependency the bundle reads at build time.** The package is about 6.5 MB
  on disk, because it holds every icon; the page gets only the paths it imports.
- **MDI icons are drawn with a little padding on their grid,** so one looks a
  little smaller than its box.
- **The bundle grew by about 1 kB** for the twelve icons in use (measured on the
  gallery's build).
