# Tokens, themes and type

_Part of [Design system](./design-system.md)._

## Tokens

CSS custom properties in three layers
([ADR-054](../../decisions/ADR-054-component-tokens.md)):

| Layer     | Where                                                                | Holds                                                                                         |
| --------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Primitive | [primitives.css](../../packages/ui/src/design/tokens/primitives.css) | every raw color and scale value: the ink, amber, phosphor and red scales, type, space, radius |
| Semantic  | [themes.css](../../packages/ui/src/design/tokens/themes.css)         | what each color is for, per theme: `--surface-panel`, `--color-action`                        |
| Semantic  | [scale.css](../../packages/ui/src/design/tokens/scale.css)           | type, space, focus and motion the whole page shares: `--text-ui`, `--tracking-caption`        |
| Component | each component's own CSS module                                      | how that component looks: `--button-bg`, `--field-box-border-color`, `--monitor-side-width`   |

**The token rule:** a component declares its tokens on its base rule and reads
them there, and every other rule only sets tokens.

```css
.button {
  --button-bg: var(--surface-raised);

  background: var(--button-bg);
}

.button:hover {
  --button-bg: var(--surface-hover);
}
```

- **Only the base rule sets properties.** A state, a variant, an at-rule such as
  forced colors, and a rule reaching into another component only set tokens.
- **How a thing looks is always a token.** Only what says how it's laid out,
  such as `display: flex`, may be written in the base rule, and only while no
  state changes it.
- **Tokens are named for their component:** `--<component>-<part>-<what>`, using
  `bg`, `text`, `radius`, `text-size`, `weight` and `font` for the common ones.
- **One component changes another by setting its token,** never its properties:
  `.status [aria-pressed="true"] { --button-bg: … }`.
- **A color is written out only in the primitives,** and only the semantic layer
  names a color primitive, so a theme stays one change of attribute. A component
  names the semantic layer for color, and may name the scale or a space
  primitive.
- **Space, corners, weight and time come from the scale.** A one-off layout
  measure, such as a dialog's `28rem`, is written in its token.
- **The focus ring** reads `--focus-ring-width` and `--focus-ring-offset`, which
  a component sets for its focus state, and falls back to the scale.
- **The tests hold the rules**
  ([tokens test](../../packages/ui/test/tokens.test.ts),
  [component tokens test](../../packages/ui/test/component-tokens.test.ts)):
  - every pairing in [pairings.ts](../../packages/ui/test/pairings.ts) meets
    WCAG 2.2 AA in every look: 4.5:1 for text (1.4.3), 3:1 for the parts of a
    control, icons and the focus ring (1.4.11);
  - each state of each component has its text at 4.5:1 on that state's
    background, read from its sheet, in every look;
  - every color token is in a pairing or exempt, with the reason (disabled text,
    decorative hairlines, the dot grid);
  - no raw color outside the primitives, and no color primitive outside the
    semantic layer;
  - both themes define the same tokens, and a high-contrast block only raises
    tokens its theme has;
  - every sheet keeps the token rule above, and reads only tokens it declares;
  - every text size comes from the type scale, and no size is below 11 px.

## Themes

The page's root carries `data-theme` and `data-contrast`
([theme.ts](../../packages/ui/src/design/theme.ts)):

- **Dark** is the default, and the page's look before any script runs.
- **Light** keeps the bright brand fills, outlined by deeper amber and green
  edges, and uses those deeper tones for text: phosphor is too faint on white.
- **The theme follows the system** (`prefers-color-scheme`) until the user picks
  one, in the palette; the choice is kept with the
  [preferences](./state.md#preferences).
- **More contrast** follows `prefers-contrast: more`, in either theme: brighter
  text, stronger borders and deeper accents.
- **Both update live** when the system's setting changes.

## Type, size and motion

- **Geist** for the interface and **Geist Mono** for ids, numbers, paths, logs
  and code, bundled from fontsource (SIL Open Font License) and served by
  `ork ui` itself. No font is fetched from anywhere else, and no asset is
  inlined as a `data:` URL, so the page's policy (`font-src 'self'`) holds.
- **Tabular numerals** everywhere.
- **Compact by default:** 13 px for the interface and 12 px for monospace, at
  the browser's default text size. No text is below 11 px there. A comfortable
  density (`data-density="comfortable"`) is roomier.
- **Every size is in rem, never px,** so the whole interface follows the
  browser's text size: space, corners, borders, and where the panels stack. The
  graph's pan, zoom and node positions stay in px, as they're geometry that has
  to meet the pointer and the SVG, not design values. A test holds the style
  sheets to this.
- **Line heights have no unit,** so they follow the text they're on.
- **Targets are at least 24×24 px** at the default text size (WCAG 2.5.8):
  `--control-height` never goes below `--target-min`
  ([L135](../gaps/limits-tokens.md)).
- **Focus** is a `--focus-width` amber outline outside the element, on every
  focusable element (`:focus-visible`), never only a glow.
- **Forced colors** take fills and shadows away, so what they say moves to what
  stays: the selected run, node and tab and an unread item keep an outline in
  `Highlight`, the highlighted list item takes `Highlight`, and disabled
  controls use `GrayText`.
- **Motion** is brief, and none when `prefers-reduced-motion: reduce` is set.
  What repeats moves in steps, not smoothly: a running status's glyph blinks.
