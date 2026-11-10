# Components and copy

_Part of [Design system](./design-system.md)._

## Components

Each lives in [`src/components/`](../../packages/ui/src/components) with a CSS
module on the tokens, and has a keyboard test and an axe test
([tests](../../packages/ui/test/components)).

| Component                 | On      | Notes                                                                                                                               |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `IconButton`    | Base UI | primary, danger, ghost and default; an icon button needs a `label`                                                                  |
| `Tip`                     | Base UI | opens on hover and focus, Escape closes it, and it can be hovered                                                                   |
| `Menu`                    | Base UI | actions and separators; arrows reach a disabled item, which does nothing                                                            |
| `Popover`                 | Base UI | a small titled panel, anchored to its trigger                                                                                       |
| `Dialog`, `ConfirmDialog` | Base UI | modal, with `aria-modal`; a confirm dialog is an alert dialog, focus on Cancel, and can hold a choice its action takes              |
| `Tabs`                    | Base UI | the active tab has a line as well as brighter text                                                                                  |
| `Select`, `Combobox`      | Base UI | a short list, or one long enough to filter                                                                                          |
| `Checkbox`, `Switch`      | Base UI | inside their label, so the whole row is the target                                                                                  |
| `Toasts`                  | Base UI | `toasts` adds one from outside React; F6 jumps into them                                                                            |
| `Meter`                   | Base UI | a row of blocks; the value is always in words too                                                                                   |
| `StatusBadge`             | Ork     | a pixel glyph and a word, bare or as a pill; each color has its own shape                                                           |
| `EndBadge`, `EndNote`     | Ork     | how a node ended: the kind's word toned by who acts, "may pass" in words; the note adds the hint, who acts and a closed Details     |
| `Kbd`, `EmptyState`       | Ork     | a key hint, and what is missing with the next step and its command (`cli`)                                                          |
| `CopyCommand`             | Ork     | the code block: full width, a strong edge, its copy button top right                                                                |
| `Markdown`                | Ork     | untrusted text as a view: a tree mapped to elements, a link allow-list, no HTML ([design](./panels-decisions-readable.md#markdown)) |
| `FoldedText`              | Ork     | content clipped at 20 lines behind Show all / Show less, measured ([design](./panels-decisions-readable.md#folding))                |
| icons                     | MDI     | one path each, in the text color; named for what they mean here                                                                     |

- **Icons come from**
  [Material Design Icons](https://pictogrammers.com/library/mdi/) through
  `@mdi/js`, and only through
  [icons.tsx](../../packages/ui/src/components/icons.tsx); the bundle takes only
  the ones imported ([ADR-042](../../decisions/ADR-042-icons-mdi.md)). The
  status glyphs are the exception, drawn in
  [status-glyphs.tsx](../../packages/ui/src/components/status-glyphs.tsx), as
  MDI's blur at 10 px.
- **A confirm dialog whose action waits** for the server (`onConfirm` returns a
  promise) stays open until it answers, Escape included, and keeps a refusal in
  it as an alert; its confirm can be primary, for a cost such as a paid run,
  rather than danger. A dialog can be **wide** (40rem), for text to read.
  `ItemStatusBadge` is the status badge for a feedback item's status, on the
  same tones, with its own shapes for `new`, `accepted` and `published`.
- **Every control can name its CLI twin** (`cli`). A button shows it in a
  tooltip, on its own line under the words as a code block with no copy button
  (a tooltip can't be clicked into), and gives it to screen readers as its
  description ("CLI: …"); the tooltip can say more above it (`tip`), such as why
  it's disabled. A confirm dialog shows it as a `CopyCommand` instead, because a
  tooltip there would cover the description, and Escape would close the tooltip
  and not the dialog; focus starts on Cancel, past the copy button.
- **Base UI's `<style>` elements are off** under the page's policy. Its one
  rule, for lists that scroll, is carried in `base.css`.
- **Component styles write out no size, duration or layer,** only tokens (tested
  with the tokens).
- **The panels' own pieces** (the node card, the tree row, the log line, the
  decision card and the chat bubble) are built with their panels.

### How a node ended

The server resolves each end (`EndView`: the kind's label, who acts, whether it
may pass, the hint, the guide's anchor) onto a tree node's `end` and onto every
`node.finished` it serves, an old one through core's `endOf`; the UI never reads
`error` for a decision and branches on the actor and `transient`, never the kind
([contract](../../packages/server/src/contract-ends.ts)).

- **`EndBadge`** is `StatusBadge` with the kind's word, toned by actor: the
  agent, the workflow and Ork red, your account amber, the provider and you
  grey. A kind that may pass adds "may pass" in words. None for a good end.
- **`EndNote`** is the story of one end: the badge and Ork's sentence, what to
  do, who acts, a link to the guide, and **Details**, the scrubbed raw text in a
  well that starts at its top, closed by default, with a copy button; none
  without a detail. A hint that points to Details loses that sentence when there
  is none.

**The gallery** shows every component in its states, with a theme switch:
`pnpm ui:dev`, then `/gallery.html`. It never ships: `vite build --mode gallery`
builds it alone, for a check under the page's policy. jsdom has no layout, so a
dialog's Tab trap, real contrast and 200% zoom are checked there in a browser,
as each UI feature's real-browser audit ([C6](./limits.md)).

## Copy

Written for engineers, in the CLI's words:

- **Say what is true, with the CLI's nouns:** run, node, decision, session,
  worktree. Ids are monospace and short (`4f2a1c`), and copy in full.
- **A name reads as code:** a node, a field, a node type, a branch, a path, an
  id, and a program named as a thing ("`ork ui` is back"). Messages and copy
  mark one with backticks, and
  [`CodeText`](../../packages/ui/src/components/code-text.tsx) shows it as
  inline code, so `human.gate` reads apart from the sentence. A screen reader
  hears the words without the marks. Only Ork's own words are marked: a
  decision's question, a command, what a model says and why a node failed show
  exactly as written, so a person never approves or reads different characters.
  A problem's link names its node in code; other button labels and a run's own
  name stay plain.
- **A command is a code block, however short:** any `ork …` or shell command the
  user would type or copy is a
  [`CopyCommand`](../../packages/ui/src/components/copy-command.tsx), the
  sentence before it ending in a colon ("Choose one in the Runs panel, or in a
  terminal:"), never inline code. An empty state takes it as `cli`; a control's
  tip shows its `cli` as a block line. What a screen reader is told can keep the
  command in the sentence.
  [A test](../../packages/ui/test/inline-commands.test.ts) fails on a backticked
  command, or a `<code>` one, in the UI's source, but for a short, commented
  list of names.
- **A copy button belongs only to a block,** a code block or a well, in its
  top-right corner, never beside inline code or an inline value.
- **Terse and exact:** "Paused — 2 nodes held", "build failed: exit 1", "3
  decisions waiting". No marketing, no exclamation marks, never "Oops".
- **Every control has its CLI twin on hover:** the Pause button's tooltip shows
  `ork pause 4f2a1c` as a block line under its words.
- **Errors say what happened and what to do next,** in the server's words.
- **Empty states teach the next step:** "No runs yet. Start one with Run
  workflow, or in a terminal:", then `ork run <workflow>` as a code block.
