# Run outputs in the Monitor

_Part of [The panels](./panels.md)._

A part of the [Monitor](./panels-runs-and-monitor.md#monitor).

Status: **Built** ([component](../../packages/ui/src/panels/run-outputs.tsx),
[hook](../../packages/ui/src/panels/use-run-outputs.ts),
[test](../../packages/ui/test/panels/run-outputs.test.tsx)); the real-browser
check in dark, light and high contrast at 200% zoom is not run yet. The server
side is built: `RunView.outputs` on [`GET /api/runs/:id`](../server.md), from
core's `outputsText` ([source](../../packages/core/src/run/outputs-text.ts)).
The twin of what `ork run` and `ork logs <run>` print under the summary line.

## Contents

- [Purpose and place](#purpose-and-place)
- [When it shows](#when-it-shows)
- [Layout](#layout)
- [Copy](#copy)
- [Keys, names and tokens](#keys-names-and-tokens)
- [Limits](#limits)

## Purpose and place

A finished run's declared `outputs:` are its result (the issues workflow's
`integrated`, `leftOut` and `url`), so they sit where the result is read: a card
**between the stat strip (and "Why the run stopped") and the graph**, in
[run-monitor.tsx](../../packages/ui/src/panels/run-monitor.tsx), after
`RunEnds`. It is one component, `RunOutputs` (`run-outputs.tsx`,
`run-outputs.module.css`), with a hook that reads the run, `use-run-outputs.ts`.
No new panel, key, rail entry or palette command.

## When it shows

The stream's run list leaves `outputs` out, so the hook reads
`client.call("run", { params: { id } })` once when the run's `live` becomes a
status that ended it (`succeeded`, or any of `RunEnds`' `STOPPED`), and for a
run that is already over when opened. It reads again at the run's next end
(after **Resume…**), and shows nothing while the run is `running` or `paused`.

| State             | What shows                                                        |
| ----------------- | ----------------------------------------------------------------- |
| Running, paused   | Nothing.                                                          |
| Loading           | Nothing: no skeleton, since most workflows declare no outputs.    |
| None declared     | Nothing: no card, no empty state, no heading.                     |
| Ended, some       | The card, one entry per output in the server's order (key order). |
| Failed or stopped | The card too, with the outputs the run has.                       |
| Read refused      | The card with one alert line, below.                              |

An output whose text is empty shows its name and `empty` in muted text, no
block. There is no disabled state: the card has no control that can be off.

## Layout

A card like `RunEnds`: `--surface-panel`, `--radius-panel`, padding
`--gap-tight` `--gap`, entries in a list with `--gap` between, so each is a
unit. Its heading is a visible caption, **Outputs**, in the caption tokens
(uppercase is right for a heading); the section is named by it
(`aria-labelledby`), at the heading level the Monitor's other sections use.

Each entry is a list item: a **name row**, then the value.

- **The name row** is the output's key in `--font-mono` at `--text-small`,
  `--color-text`, with its case kept: a key is code and `leftOut` is not
  `LEFTOUT` (so it does not use the caption tokens, nor `CopyCommand`'s
  `caption`). When the value was cut, the word `(cut)` follows it in muted text,
  as well as the note below, so no state is color alone.
- **A short value** (one line, at most 80 characters, not cut) is a
  [`CopyCommand`](../../packages/ui/src/components/copy-command.tsx) with
  `label` `Copy <name>`: a sunken block, a strong edge, wrapped, selected whole
  by a click, with its copy button in the corner.
- **Any other value** is a bar, then an
  [`OutputWell`](../../packages/ui/src/components/output-well.tsx) with
  `follow={false}` (it reads from its start) and `label` `Output <name>`. The
  bar has the name at its start and a
  [`CopyButton`](../../packages/ui/src/components/copy-button.tsx), label
  `Copy <name>`, at its end, as
  [`EndDetails`](../../packages/ui/src/components/end-details.tsx) does; it
  wraps when narrow. The well keeps its own height, `min(20rem, 40vh)`, and
  scrolls inside it, so twenty lines never push the graph off the screen by more
  than that. Copy takes what shows.
- **The value is plain text, as recorded:** no Markdown, no link, no `CodeText`
  marks, since it comes from a session and a person reads exactly what it says.
  A URL is selected or copied, not opened.
- **After the last entry, when any was cut,** one note and one command for the
  card: the sentence ends in a colon, then a `CopyCommand` of
  `ork logs <run> --json` (the run's id, in full).

On a narrow panel the card is one column and the blocks take its width; text
wraps anywhere (`overflow-wrap: anywhere`) and nothing needs a horizontal
scroll, so 200% zoom (WCAG 1.4.10) holds. A run's card is read once, so it does
not update while open; a refreshed Monitor reads it again. The graph moves down
once when the card arrives, about a read after the run ends.

## Copy

| Where                  | Words                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card heading           | `Outputs`                                                                                                                                                                                                  |
| A cut entry's name row | `<name>` then `(cut)`                                                                                                                                                                                      |
| Empty value            | `empty`                                                                                                                                                                                                    |
| Cut note               | `Cut at 20 lines or 2,000 characters. The full values:`                                                                                                                                                    |
| Cut command            | `ork logs <run> --json`                                                                                                                                                                                    |
| Copy button            | `Copy <name>`; its status `Copied.` or `Copy failed: select the text instead.`                                                                                                                             |
| Well's name            | `Output <name>`                                                                                                                                                                                            |
| Read refused           | `Could not read the outputs: <server's words>. See them with:` then the `ork logs <run>` command (`role="alert"`, in `--color-status-failed`, with the failed glyph; the command in its own `CopyCommand`) |

The 20 and 2,000 are `OUTPUT_MAX_LINES` and `OUTPUT_MAX_CHARS` from core's
`outputs-text.ts`: the component takes them from there, never writes the
numbers. The CLI's pointer words may differ; the facts may not.

## Keys, names and tokens

- **Keys:** none of its own. Tab goes through each entry's copy button and well
  in reading order. A well is a scroll region with the focus: the arrows, Page
  Up, Page Down, Home and End scroll it, and its focus ring is inset, as the
  well's is elsewhere. Escape does nothing here.
- **Names:** the section is **Outputs**; each well is `Output <name>`; each copy
  button is `Copy <name>`. A short value's block is named by its copy button.
- **Said aloud:** nothing new. The run ending is already a
  [notification](./panels-chats-notifications-and-usage.md#notifications), and
  the card arriving is not news. A copy status is an `<output>`, as everywhere.
- **Tokens:** none new. The card declares its own, in its base rule, read from
  the existing ones ([ADR-054](../../decisions/ADR-054-component-tokens.md)):
  `--run-outputs-bg: var(--surface-panel)`, `-radius: var(--radius-panel)`,
  `-padding: var(--gap-tight) var(--gap)`, `-gap: var(--gap)`,
  `-heading-text: var(--color-text-muted)` with the caption font, size, tracking
  and case tokens, `-name-text: var(--color-text)`,
  `-name-font: var(--font-mono)`, `-name-size: var(--text-small)`,
  `-note-text: var(--color-text-muted)`,
  `-error-text: var(--color-status-failed)`. Every foreground is `--color-text`,
  `--color-text-muted` or `--color-status-failed` on `--surface-panel`, a
  pairing [the contrast test](../../packages/ui/test/pairings.ts) already
  covers; the wells and blocks keep their own tokens.
- **Tests:** `test/panels/run-outputs.test.tsx` covers the states above (none,
  short, multi-line, cut, empty, refused, running) and the focus order; the same
  file has an axe pass with a cut entry. A real-browser check in dark, light and
  high contrast at 200% zoom belongs to the build ([C6](./limits.md)).

## Limits

- A URL in an output is not a link (see above): a person selects or copies it.
- The card shows the cut value; the full one is `ork logs <run> --json` or the
  `run.finished` event, not the UI.
