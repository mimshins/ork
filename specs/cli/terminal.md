# The terminal kit and `--plain`

_Part of [The ork CLI](../cli.md)._

Status: **Built**: the kit (mode, theme, chips, layout, keys, and the select,
text and confirm prompts) and the global `--plain` flag are built. `ork run`'s
transcript and summary ([code](../../packages/cli/src/run/view.ts),
[tests](../../packages/cli/test/run-transcript.test.ts)), `ork decide` (its
card, its `--list` rows and `--verbose`), the permission prompts, every
yes-or-no question (`output.ts`'s `confirm`) and `ork chat`'s message line ask
through the kit; the listings and checks use its chips and tables
([code](../../packages/cli/src/term/mode.ts),
[tests](../../packages/cli/test/term-kit.test.ts),
[select tests](../../packages/cli/test/term-select.test.ts),
[text and confirm tests](../../packages/cli/test/term-text-confirm.test.ts)).
The user guide: [the terminal](../../docs/guides/terminal.md).

One kit in `packages/cli/src/term/`, with no dependency (`node:readline`,
`node:util`'s `styleText`), gives every command the same look and the same
prompts. Text from agents and tools still goes through `plain()` before it is
styled.

## Mode

A stream is **rich** only when it is a terminal and nothing asks for plain:
`NO_COLOR` set and not empty, `ORK_PLAIN` set and not `0`, `false` or empty, or
`TERM=dumb`. A prompt also needs a raw-mode input. Otherwise it is **plain**: no
escape codes, no redraw, and prompts that print `question [y/N] ` or numbered
options and read a line, as they always did, so scripts and tests that feed
lines keep working. A plain prompt on a terminal tells `readline` not to redraw
the line either.

`--plain` is a global flag: `bin.ts` takes it out of the arguments (up to a
`--`) and sets `ORK_PLAIN=1`, which every child `ork` inherits. Since the flag
is set after the modules load, `style()` and every mark read the environment
when used, never in a module-level constant. `ork --help`, every command's
`--help` and tab completion list it.

## Look

- **Roles** (`theme.ts`): accent, ok, warn, danger, muted. The 16 ANSI colors
  only, so a terminal's own theme decides the shades; muted is "dim".
- **Chips** (`chips.ts`): `ASK`, `RUN`, `OK`, `FAIL`, `WAIT` on a background
  with a fixed foreground (black or bright white), and a node chip whose
  background is one of six, by a hash of the node id, so a node has the same
  color on every line and in every run. Plain, a chip is `[ASK]`, `[node-id]`.
  Nothing is said by color alone: a chip has words, a mark a symbol (`✓`, `✗`,
  `❯`).
- **Layout** (`layout.ts`): `wrap` at spaces to a width, `cut` to one line with
  `…`, `hang` under a lead, `widthOf` and `rowsOf`; the width comes from the
  stream (80 with none, never under 20).

## Prompts

All three take a `PromptIO` (input, output, env, and optionally the caller's own
line reader and its Ctrl-C hook), draw only their own lines (cursor up, clear
down, never the screen), hide the cursor while open, redraw on a resize,
collapse to one line when answered, and restore raw mode and the cursor on every
exit. A withdrawn prompt (`AbortSignal`) rejects.

While a prompt is drawn, any line `write` or `writeErr` (`output.ts`) prints to
a terminal goes through the open region (`printAbove`): it erases the card,
prints the line, and draws the card again, so a run's transcript from parallel
nodes scrolls above a question on stderr and never corrupts the rows the card
counts.

- **`select`**: options with an optional label and description, one marked
  `(recommended)` and preselected. ↑/↓ and `j`/`k` move, `Home`/`End`, `1`–`9`
  jump, `Enter` chooses, `n` adds a note (a line edited in place, when the
  prompt takes one), `d` shows or hides the details (a document, cut to the
  screen with "N more lines"), `q` or `Esc` leaves the question for later (when
  allowed), `Ctrl-C` restores the terminal and stops. A key line names the keys.
  It resolves `{ kind: "chosen", id, note? }`, `{ kind: "later" }` or
  `{ kind: "interrupted" }`. Plain, it prints
  `1) id label - description (recommended)` and asks `Choose [n]: `, taking a
  number, an id, or Enter for the recommended one, `d` for the details, and then
  asks the note's line.
- **`readText`**: one line edited in place (arrows, `Home`/`End`, `Backspace`,
  `Delete`, `Ctrl-U`), scrolled when long; `Enter` sends, `Esc` leaves. Plain,
  it asks ` message:`.
- **`confirm`**: `Yes` and `No`, moved with ←/→ (or `h`, `l`, Space); `y` and
  `n` answer at once, `Enter` takes the one shown (no, unless `default: true`),
  `Esc` is no. Plain, it asks ` question [y/N]` (`[Y/n]` for a default of yes);
  anything but yes is no, and a closed input is no.

On Ctrl-C a prompt restores the terminal, then calls the caller's hook (the
terminal `HumanChannel` stops the run), or sends the process `SIGINT`.
`confirmOrStop` reports it as `null`, so a permission prompt then asks for no
note and parks, as a question does. A plain `select` prints a `footer` (a long
document's "Type d to read it") just above `Choose`.

## Listings and checks

Rich, the listing commands read as one: a table (`table.ts`) puts each column at
its widest cell with a two-space gap, and cuts its flexible column (a workflow,
a project's root, a feedback title) with `…` so a line fits the screen, never
under 8 columns. Status is a chip with words (`RUN`, `OK`, `FAIL`, `PAUSED`,
`BUDGET EXHAUSTED`), as are a project's mode and a missing clone, a feedback
item's status, a worktree's `MERGED`, a trigger's `LIVE` or `OFF`, and a limit's
`WARN`. `ork doctor` puts `OK`, `WARN`, `FAIL` or `SKIP` before each check,
wraps its detail under the detail column and dims and indents its hint.
`ork validate` puts an `ERROR` or `WARN` chip on each diagnostic with its
message wrapped under it and its code dimmed, and an `OK` or `FAIL` chip on the
verdict. Plain (not a terminal, `NO_COLOR`, `--plain`, `ORK_PLAIN`) and `--json`
print what they always did: no chip, no cut, no escape code.

## Limits

- **L249** A code point counts as one column ([gaps](../gaps.md)).
- **L250** A select with more options than the screen has rows is not scrolled
  ([gaps](../gaps.md)).
- **L251** `SIGKILL` and `SIGTERM` can leave the cursor hidden
  ([gaps](../gaps.md)).
- **L252** Only tool lines are cut to the screen width ([gaps](../gaps.md)).
- **L253** A live `ork chat` asks line by line ([gaps](../gaps.md)).
- **L254** Plain output has not been checked with a screen reader
  ([gaps](../gaps.md)).
- **L255** A `--plain` that is another flag's value is taken as the flag
  ([gaps](../gaps.md)).
