# Decisions: reading and filtering

_Part of [The panels](./panels.md)._

Status: **Built.** The readable-gates change (a gate's `document`, Markdown,
folding, filters), as designed except for the differences in
[Built differently](#built-differently) below. Filters, the Monitor control,
keys, names, copy and tokens are in
[Decisions: filters, keys and tokens](./panels-decisions-filters-and-keys.md).

A person approving a gate reads what it asks. A decision's `question`, `context`
and `document` are **untrusted text** (a model's report, a file's content) shown
as a **view**: the stored text is the author's string, nothing is inserted as
HTML, executed or fetched.

## Contents

- [The card](#the-card)
- [Markdown](#markdown)
- [Folding](#folding)
- [The document dialog](#the-document-dialog)
- [Code blocks and a permission's command](#code-blocks-and-a-permissions-command)
- [Wrapping](#wrapping)
- [Built differently](#built-differently)

## The card

Top to bottom: the **heading** (an `h3`: `feature · 4f2a1c · approve`, then
`, passed on by <owner>`, as today, with **Open run** after it), the
**question** (Markdown, folded), the **context** (Markdown for a question's
context, folded; a permission's context is a code block), the **Read** row when
there is a document, the note box, the options, a refusal. The card is named by
its heading and the first line of the question as plain text (a hidden element
the card's `aria-labelledby` reads, cut at 120 characters with `…`), so a screen
reader hears what it asks, not the whole text.

- **The question's top-level paragraphs are strong** (`--weight-strong`); lists,
  quotes and code in it are regular. The context is muted, as today.
- **The Read row** is a ghost button, "Read document", with the length after it
  in muted mono (`212 lines`), full width on a narrow panel. Its tooltip gives
  the CLI twin `ork decide 4f2a1c --id 7b3e --document`. It sits between the
  text and the note box, so the options stay below one scroll of the question (a
  folded question is at most 20 lines).
- **A document-only decision** (a short or empty question) is answered without
  opening the document: the options never wait on it.
- **States:** the card is as before (sending: options `aria-disabled`, cursor
  `progress`; a refusal stays in the card). A document that fails to render
  falls back to its text as plain pre-wrapped text with the line "Could not
  render this as Markdown: showing the text as written." above it, never an
  empty card.

## Markdown

One component renders it (`Markdown`, in
`packages/ui/src/components/markdown.tsx`, built per the ADR: a parser that
gives a tree, mapped by Ork's own renderer to React elements, so no HTML string
exists). It takes `text` and `startLevel` (a heading's level offset: 4 in a
card, whose heading is an `h3`; 3 in the dialog, whose title is an `h2`, so
`heading-order` holds).

| Source                 | Shown as                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#` to `######`        | `h4`, `h5`, `h6`, `h6` … at `startLevel` 4; all `--text-ui` strong, so the card stays dense (level is structure, not size)                                                  |
| paragraph              | a paragraph; **a single newline is a line break**, as in a chat: gate text is written in lines                                                                              |
| `-`, `1.` lists        | `ul`, `ol`, nested to any depth; markers kept (a bullet, the number) so a list reads without color                                                                          |
| `*em*`, `**strong**`   | `em` (italic), `strong`                                                                                                                                                     |
| `` `code` ``           | inline code in mono, on `--surface-sunken`                                                                                                                                  |
| fenced and indented    | a [code block](#code-blocks-and-a-permissions-command); a fence's language is its caption                                                                                   |
| `[text](url)`          | an allowed link, or text                                                                                                                                                    |
| `> quote`              | a `blockquote`: a strong-border bar at the start and muted text                                                                                                             |
| `---`                  | an `hr`, a hairline                                                                                                                                                         |
| image `![alt](src)`    | text only, `image: alt` (or `image` with no alt), muted, never loaded                                                                                                       |
| raw HTML, block/inline | its source as text: a block as a code block (no copy label of its own beyond "Copy code"), inline as the characters. `<script>` and `<img onerror>` are words, not elements |
| tables, task lists     | not in the subset: they show as their source lines (a [gap](../gaps.md))                                                                                                    |

- **Links:** only `http:`, `https:` and `mailto:` are links. They open in a new
  tab (`target="_blank"`, `rel="noopener noreferrer"`), are underlined as well
  as `--color-link` (not color alone), and end with a hidden "(opens in a new
  tab)" for a screen reader. Any other target (`javascript:`, a relative path
  such as `decisions/ADR-068-….md`, `file:`, `data:`) is **not a link**: its
  text shows, then its target in mono in parentheses, so the path is visible and
  copyable: `ADR-068 (decisions/ADR-068-document-field.md)`. When the text is
  the target, it shows once.
- **No element or attribute comes from the text** but the ones in the table:
  never a `style`, `class`, `id`, event handler, `href` outside the allow-list,
  `src`, or `dangerouslySetInnerHTML`.

## Folding

Past about 20 lines, a question or a context folds, each by itself.

- **Folded** is a plain block (no `role`, no name: it is not a landmark and not
  a scroll region, and a card would otherwise list two of them) with
  `max-height: 20lh` and `overflow: hidden`, followed by a ghost button: "Show
  all (62 lines)". It has `aria-expanded="false"` and `aria-controls` the
  region's id. Pressing it sets the region to its full height, and the button
  reads "Show less" (`aria-expanded="true"`); the focus stays on it, and a fold
  that closes scrolls the card's top into view if it left the screen.
- **Measured, not guessed:** the region is folded when its content is taller
  than 20 lines (`scrollHeight` against `20lh`), measured again when the card's
  width changes (a `ResizeObserver`), so a narrow panel folds what a wide one
  doesn't. A rendering with no layout (a test in jsdom) falls back to counting
  the source's lines. 20 lines or fewer: no button.
- **A link inside folded text can take the focus while clipped.** So the focus
  entering the region unfolds it (WCAG 2.4.11), and the button then says "Show
  less".
- **The note box and the options sit outside** the folded region, so the answer
  never scrolls away. The button's "(62 lines)" is the cue that text is hidden;
  there is no fade, so no color or gradient carries the meaning.
- **Not scrollable:** a folded region has no scroll bar and no tab stop; the
  document dialog is where long text scrolls.

## The document dialog

"Read document" opens the shared [`Dialog`](./design-components-and-copy.md) at
its wide size (40rem).

- **Title** (`h2`): `approve · 7b3e`, the node id and the decision id, in mono.
  **Description:** "Document for run 4f2a1c. Read-only." It names the run so a
  screen reader says where it is.
- **Body:** one scroll region, the rendered document (`startLevel` 3), as
  `role="region"` with `aria-label="Document"` and `tabindex="0"`, so it takes
  the focus and the arrow, Page and Space keys scroll it (WCAG 2.1.1, axe
  `scrollable-region-focusable`). It has the focus ring inset
  (`--focus-ring-offset` negative, as the output well), a strong border and
  `--surface-sunken`; `max-height: 60vh` and a `min-height` of 8 lines. Past
  that, the dialog scrolls, as every dialog does, so 200% and 400% zoom hold.
- **Footer:** a single **Close** button (default variant, right aligned).
- **Focus:** starts on the document region. `Escape` and Close shut it, and the
  focus goes back to "Read document". The card behind is unchanged and is the
  same card once closed, so an answer is one click. If the decision settles
  while the dialog is open, the dialog keeps its text, and on close the focus
  goes where
  [the panel moves it](./panels-builder-logs-and-decisions.md#decisions) (the
  next card, or the panel).
- **Read-only:** no editing, no copy-all button (a code block still has its
  own).
- **States:** the document renders in place, with the same fallback as the card.
  There is no loading state: the record carries the text.

## Code blocks and a permission's command

A fence, an indented block, a raw HTML block and a permission request's context
are all one [`CopyCommand`](../../packages/ui/src/components/copy-command.tsx)
block: full width, `--surface-sunken`, the strong edge, text in mono wrapped
(`pre-wrap`, `overflow-wrap: anywhere`), the copy button in the top-right corner
with its "Copied." status before it, said aloud (an `<output>`, as today).

- **A fence's language** (`yaml`) is a caption in the top-left, in the caption
  style, on the same row as the button. No language: no caption.
- **A permission's context** is the command or path as written, newlines kept,
  in one block. When the engine cut it at 4,000 characters, the block's last
  line is `…` as it came. Other inputs (pretty-printed JSON) are a block,
  captioned `json`.
- **Copies exactly the text** in the block, no caption and no trailing newline
  added.
- **Names:** "Copy code" in a text with one block; "Copy code block 2 of 3" with
  more; "Copy command" on a permission's block; each followed by where it is in
  parentheses, the node id: "Copy code (approve)", "Copy command (approve)", and
  in the document dialog "Copy code (approve document)". Each says what it does,
  and the names differ inside one text and between cards (WCAG 2.4.6).
- **No sideways scrolling in a block:** long lines wrap. The cost is that a long
  line's indentation is lost at the wrap, which is the lesser harm to a keyboard
  user than a nested scroller.

## Wrapping

Everything a decision shows wraps inside the card: `overflow-wrap: anywhere` and
`min-width: 0` on the text, the lists, the quotes and the flex rows (the
heading, the options). A 200-character path or URL with no break wraps at 320
CSS px and at 400% zoom; nothing scrolls sideways (WCAG 1.4.10). A list's marker
and a quote's bar keep their width and the text takes the rest.

## Built differently

- **The quote's bar** is the neutral hairline (`--hairline` in
  `--color-border`), not a strong border: the side-stripe rule
  ([side-stripes.test.ts](../../packages/ui/test/side-stripes.test.ts)) allows
  no other edge down one side. A quote is still set apart by the indent and the
  muted text.
- **The document dialog** lives in its card: if the decision settles while it is
  open, the card goes and the dialog with it, rather than keeping its text.
- **A raw HTML block** uses the code block's own "Copy code" name, as the design
  says.
- **The render-failure fallback** also covers text nested more than 50 blocks
  deep (a run of thousands of `>`), which would overflow the stack; the card's
  name then takes the first source line. A reference-style link's definition
  (`[1]: path`) shows as text, so the target is never lost.
- **Tokens** are named for their sheets, as the token rule requires:
  `--folded-text-*` (not `--fold-*`) and `--decisions-document-*` (not
  `--document-view-*`).
- **The keys of the dialog** never answer: the dialog is a portal, so a key
  pressed in it reaches the card in React's tree, and the card ignores any key
  whose target is outside its own DOM.
- **Focus after something goes:** when a focused element leaves the panel (Clear
  filter, a card settling under its open dialog) and the focus falls to the
  page, it goes to the panel, which is named `Decisions`.
