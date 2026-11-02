# Design system

_Part of [The UI](../ui.md)._

Status: **Partial.** Built: the tokens, the themes, the fonts and the page's
defaults ([design](../../packages/ui/src/design/)), with the contrast and
layering tests ([tokens test](../../packages/ui/test/tokens.test.ts),
[pairings](../../packages/ui/test/pairings.ts),
[theme test](../../packages/ui/test/theme.test.ts)); and the base components
([components](../../packages/ui/src/components/),
[tests](../../packages/ui/test/components/)). The workspace, the panels' own
pieces and the graph's look are planned (M2).

## The language

An instrument panel for agents. The feel is Figma's canvas and panels crossed
with a precise, slightly futuristic instrument: dark, quiet and dense, lit only
where something needs the user.

- **The surface:** a near-black canvas with a faint dot grid, and panels over
  it. Borders are 1 px hairlines, not shadows. Glow is kept for what needs the
  user: focus, a live node, an open decision.
- **The brand pair, from the [logo](../../assets/logo/README.md):**
  - **Amber `#ffb000` is primary:** action and attention. Primary buttons,
    focus, the selected item, and anything waiting on the user.
  - **Phosphor `#3dff8a` is secondary:** live and done. Running, success, links.
  - **Text on either fill is the screen color `#0a0d0b`:** 10.7:1 on amber,
    14.8:1 on phosphor.
- **Status is never color alone.** Each status has its own icon shape and a
  word; the colors are running and succeeded in phosphor, waiting and paused in
  amber, failed in red, and queued, skipped and interrupted in a neutral.

## Tokens

CSS custom properties in three layers, in
[`src/design/tokens/`](../../packages/ui/src/design/tokens/):

| Layer     | File                                                                 | Holds                                                                               |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Primitive | [primitives.css](../../packages/ui/src/design/tokens/primitives.css) | every raw value: the ink, amber, phosphor and red scales, type, space, radius, time |
| Semantic  | [themes.css](../../packages/ui/src/design/tokens/themes.css)         | what each color is for, per theme: `--surface-panel`, `--color-action`, statuses    |
| Semantic  | [scale.css](../../packages/ui/src/design/tokens/scale.css)           | type, space, sizes, focus and motion: `--text-ui`, `--control-height`               |
| Component | [components.css](../../packages/ui/src/design/tokens/components.css) | what a component reads: `--button-primary-bg`, `--field-border`                     |

- **A color is written out only in the primitives.** Everything else names a
  token, and components name only semantic and component tokens.
- **A new look gets its tokens and its pairings.** A component that needs a new
  color adds a component token, and the pairings it is drawn on to
  [pairings.ts](../../packages/ui/test/pairings.ts).
- **The tests hold the rules**
  ([tokens test](../../packages/ui/test/tokens.test.ts)):
  - every pairing meets WCAG 2.2 AA in every look: 4.5:1 for text (1.4.3), 3:1
    for the parts of a control, icons and the focus ring (1.4.11);
  - every color token is in a pairing or exempt, with the reason (disabled text,
    decorative hairlines, the dot grid);
  - no raw color outside the primitives, and no primitive outside the semantic
    layer;
  - both themes define the same tokens, and a high-contrast block only raises
    tokens its theme has;
  - every `font-size` comes from the type scale, and no size is below 11 px.

## Themes

The page's root carries `data-theme` and `data-contrast`
([theme.ts](../../packages/ui/src/design/theme.ts)):

- **Dark** is the default, and the page's look before any script runs.
- **Light** keeps the bright brand fills, outlined by deeper amber and green
  edges, and uses those deeper tones for text: phosphor is too faint on white.
- **The theme follows the system** (`prefers-color-scheme`) until the user picks
  one; the choice is kept with the preferences (the state layer, planned).
- **More contrast** follows `prefers-contrast: more`, in either theme: brighter
  text, stronger borders and deeper accents.
- **Both update live** when the system's setting changes.

## Type, size and motion

- **Geist** for the interface and **Geist Mono** for ids, numbers, paths, logs
  and code, bundled from fontsource (SIL Open Font License) and served by
  `ork ui` itself. No font is fetched from anywhere else, and no asset is
  inlined as a `data:` URL, so the page's policy (`font-src 'self'`) holds.
- **Tabular numerals** everywhere.
- **Compact by default:** 13 px for the interface and 12 px for monospace, in
  rem so the browser's font size scales them. No text is below 11 px. A
  comfortable density (`data-density="comfortable"`) is roomier.
- **Targets are at least 24×24 px** (WCAG 2.5.8): `--control-height` never goes
  below `--target-min`.
- **Focus** is a 2 px amber outline outside the element, on every focusable
  element (`:focus-visible`), never only a glow.
- **Motion** is brief, and none when `prefers-reduced-motion: reduce` is set.

## Components

Each lives in [`src/components/`](../../packages/ui/src/components/) with a CSS
module on the tokens, and has a keyboard test and an axe test
([tests](../../packages/ui/test/components/)).

| Component                 | On      | Notes                                                                    |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `Button`, `IconButton`    | Base UI | primary, danger, ghost and default; an icon button needs a `label`       |
| `Tip`                     | Base UI | opens on hover and focus, Escape closes it, and it can be hovered        |
| `Menu`                    | Base UI | actions and separators; arrows reach a disabled item, which does nothing |
| `Popover`                 | Base UI | a small titled panel, anchored to its trigger                            |
| `Dialog`, `ConfirmDialog` | Base UI | modal; a confirm dialog is an alert dialog, and focus starts on Cancel   |
| `Tabs`                    | Base UI | the active tab has a line as well as brighter text                       |
| `Select`, `Combobox`      | Base UI | a short list, or one long enough to filter                               |
| `Checkbox`, `Switch`      | Base UI | inside their label, so the whole row is the target                       |
| `Toasts`                  | Base UI | `toasts` adds one from outside React; F6 jumps into them                 |
| `Meter`                   | Base UI | the value is always in words too                                         |
| `StatusBadge`             | Ork     | an icon and a word; each status color has its own shape                  |
| `Kbd`, `EmptyState`       | Ork     | a key hint, and what is missing with the next step                       |
| `CopyCommand`             | Ork     | a CLI command, a copy button, and a live result                          |
| icons                     | MDI     | one path each, in the text color; named for what they mean here          |

- **Icons come from**
  [Material Design Icons](https://pictogrammers.com/library/mdi/) through
  `@mdi/js`, and only through
  [icons.tsx](../../packages/ui/src/components/icons.tsx); the bundle takes only
  the ones imported ([ADR-042](../../decisions/ADR-042-icons-mdi.md)).
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
