# Design system

_Part of [The UI](../ui.md)._

Status: **Partial.** Built: the tokens, the themes, the fonts and the page's
defaults ([design](../../packages/ui/src/design/)), with the contrast and
layering tests ([tokens test](../../packages/ui/test/tokens.test.ts),
[pairings](../../packages/ui/test/pairings.ts),
[theme test](../../packages/ui/test/theme.test.ts)); and the base components
([components](../../packages/ui/src/components/),
[tests](../../packages/ui/test/components/)). The dock's theme is in
[the workspace](./workspace.md). The panels' own pieces and the graph's look are
planned (M2).

## The language

An instrument panel for agents, sized as a console: dense, precise, with a touch
of tech and pixel, and lit only where something needs the user
([ADR-055](../../decisions/ADR-055-console-language.md)).

- **Nested surfaces:** the canvas holds frames (8 px corner, 6 px apart). A
  frame holds its tabs and a card (6 px corner) inside a 3 px gutter, and a
  well, such as the graph's canvas with its dot grid, is set into a card.
  Surfaces do the separating, and hairlines are left for inside a card. A frame
  has an edge only in more contrast and forced colors, and a faint shadow only
  on the light theme.
- **One toolbar inset:** whatever heads a card, in any panel, reads
  `--inset-tools`, so moving between tabs doesn't shift what's on them. A test
  holds this.
- **Small elements:** a top bar of 30 px, tabs of 26 px, a status bar of 22 px
  and controls of 24 px with 4 px corners. Sizes are for the default text size.
- **The brand pair, from the [logo](../../assets/logo/README.md):**
  - **Amber `#ffb000` is primary:** action and attention. Primary buttons,
    focus, the selected item, and anything waiting on the user.
  - **Phosphor `#3dff8a` is secondary:** live and done. Running, success, links.
  - **Text on either fill is the screen color `#0a0d0b`:** 10.7:1 on amber,
    14.8:1 on phosphor.
- **The name in the top bar is the identity, not text:** the small wordmark,
  `>▮ork`, redrawn on whole pixels for 32 px and under, with no background; on
  the light theme its green is `--phosphor-700`, and its caret stays amber
  ([logo](../../assets/logo/README.md)), on its own tile so it holds in every
  theme.
- **Two voices:** Geist for names and sentences, Geist Mono for values.
- **Titles, labels, descriptions and captions read as four things.** A title is
  strong and in text color: the panel's in `--text-title`, a section's in
  `--text-ui`. A label is `--text-small`, medium, in text color. A description
  is `--text-small`, regular and muted. A label says what a field is even with
  the description gone. A caption says what a value is, or heads a group: Geist
  Mono in `--text-caption`, upper case, tracked and muted, as a column's head, a
  stat's name or a section's heading. Never an identifier, as upper case would
  misstate it.
- **Status is never color alone.** Each status has its own glyph, on a 5×5 pixel
  grid, and a word in mono; the colors are running and succeeded in phosphor,
  waiting and paused in amber, failed in red, and queued, skipped and
  interrupted in a neutral. A status sits bare among other facts, and is a
  tinted pill where it heads a view, as in a run's header.
- **Meters are blocks, not bars:** 20 of them, in phosphor, amber from 80% and
  red at the limit. Anything spent shows a block, and only the limit fills them
  all. The value is always in words too.

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
  stays: the selected run, node and tab and an unread item keep an edge in
  `Highlight`, the highlighted list item takes `Highlight`, and disabled
  controls use `GrayText`.
- **Motion** is brief, and none when `prefers-reduced-motion: reduce` is set.
  What repeats moves in steps, not smoothly: a running status's glyph blinks.

## Components

Each lives in [`src/components/`](../../packages/ui/src/components/) with a CSS
module on the tokens, and has a keyboard test and an axe test
([tests](../../packages/ui/test/components/)).

| Component                 | On      | Notes                                                                     |
| ------------------------- | ------- | ------------------------------------------------------------------------- |
| `Button`, `IconButton`    | Base UI | primary, danger, ghost and default; an icon button needs a `label`        |
| `Tip`                     | Base UI | opens on hover and focus, Escape closes it, and it can be hovered         |
| `Menu`                    | Base UI | actions and separators; arrows reach a disabled item, which does nothing  |
| `Popover`                 | Base UI | a small titled panel, anchored to its trigger                             |
| `Dialog`, `ConfirmDialog` | Base UI | modal; a confirm dialog is an alert dialog, and focus starts on Cancel    |
| `Tabs`                    | Base UI | the active tab has a line as well as brighter text                        |
| `Select`, `Combobox`      | Base UI | a short list, or one long enough to filter                                |
| `Checkbox`, `Switch`      | Base UI | inside their label, so the whole row is the target                        |
| `Toasts`                  | Base UI | `toasts` adds one from outside React; F6 jumps into them                  |
| `Meter`                   | Base UI | a row of blocks; the value is always in words too                         |
| `StatusBadge`             | Ork     | a pixel glyph and a word, bare or as a pill; each color has its own shape |
| `Kbd`, `EmptyState`       | Ork     | a key hint, and what is missing with the next step                        |
| `CopyCommand`             | Ork     | a CLI command, a copy button, and a live result                           |
| icons                     | MDI     | one path each, in the text color; named for what they mean here           |

- **Icons come from**
  [Material Design Icons](https://pictogrammers.com/library/mdi/) through
  `@mdi/js`, and only through
  [icons.tsx](../../packages/ui/src/components/icons.tsx); the bundle takes only
  the ones imported ([ADR-042](../../decisions/ADR-042-icons-mdi.md)). The
  status glyphs are the exception, drawn in
  [status-glyphs.tsx](../../packages/ui/src/components/status-glyphs.tsx), as
  MDI's blur at 10 px.
- **Every control can name its CLI twin** (`cli`). A button shows it in a
  tooltip and gives it to screen readers as its description. A confirm dialog
  shows it as text, because a tooltip there would cover the description, and
  Escape would close the tooltip and not the dialog.
- **Base UI's `<style>` elements are off** under the page's policy. Its one
  rule, for lists that scroll, is carried in `base.css`.
- **Component styles write out no size, duration or layer,** only tokens (tested
  with the tokens).
- **The panels' own pieces** (the node card, the tree row, the log line, the
  decision card and the chat bubble) are built with their panels.

**The gallery** shows every component in its states, with a theme switch:
`pnpm ui:dev`, then `/gallery.html`. It never ships: `vite build --mode gallery`
builds it alone, for a check under the page's policy. jsdom has no layout, so a
dialog's Tab trap, real contrast and 200% zoom are checked there in a browser
([gaps](../gaps.md#chores), C6).

## Copy

Written for engineers, in the CLI's words:

- **Say what is true, with the CLI's nouns:** run, node, decision, session,
  worktree. Ids are monospace and short (`4f2a1c`), and copy in full.
- **Terse and exact:** "Paused — 2 nodes held", "build failed: exit 1", "3
  decisions waiting". No marketing, no exclamation marks, never "Oops".
- **Every control has its CLI twin on hover:** the Pause button's tooltip says
  `ork pause 4f2a1c`.
- **Errors say what happened and what to do next,** in the server's words.
- **Empty states teach the next step:** "No runs yet. Start one with Run
  workflow or `ork run <workflow>`."
