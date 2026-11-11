# The terminal

Ork's commands print in color when they talk to a terminal, and ask their
questions with a list you move with the arrow keys. This page covers the keys,
the colors and chips, and how to turn all of it off.

## Questions

`ork decide`, an agent's `ask_user` and a gate show a card, then the options:

```
 ASK  reviewer  run 5e0c9b2a · 1 of 2
 Ship the CSV export?
   The tests pass; the README is not updated.

   1. ship (recommended)
      Merge it into the leader's branch.
 ❯ 2. revise
      Send it back with a note.
   3. stop
 ↑/↓ move · Enter choose · n note · d show details · q later
```

The card has an `ASK` chip, the node's chip, the run and "n of m", the question
in bold and wrapped, and the context dimmed and indented. A long context is cut
to a few lines; `d` shows all of it (or a gate's document), `d` again hides it,
and `ork decide --verbose` always shows it all. The recommended option is marked
and chosen to start.

| Key             | What it does                                      |
| --------------- | ------------------------------------------------- |
| ↑ ↓, or `k` `j` | Move                                              |
| `Home` `End`    | First, last                                       |
| `1`–`9`         | Jump to that option                               |
| `Enter`         | Choose                                            |
| `n`             | Add a note (one line; `Enter` saves, `Esc` drops) |
| `d`             | Show or hide the full context or document         |
| `q` or `Esc`    | Leave the question for later                      |
| `Ctrl-C`        | Stop, as before                                   |

The line under the options names the keys that apply. `q` is offered where a
question can wait: in `ork decide`, the question stays open for another terminal
or the browser; in a run's own prompt it does not.

Once you answer, the card collapses to one line, so the scrollback stays short:

```
 ✓ 5e0c9b2a-1 · revise
```

A yes-or-no question (a permission, `Go ahead?`) is one line with `Yes` and
`No`: `y` and `n` answer at once, ← → move, `Enter` takes the one shown (No,
unless the question says otherwise), and `Esc` is No. It collapses to
`✓ question · Yes` or `✗ question · No`. A note or message is a line you edit in
place: arrows, `Home`, `End`, `Backspace`, `Delete`, `Ctrl-U`.

## Colors and chips

A chip is a short word on a colored background: `ASK`, `RUN`, `OK`, `FAIL`,
`WAIT`, `WARN`, `SKIP`. Every node also has a chip, in a color taken from its
id, so a node is the same color on every line and in every run. The colors are
the terminal's 16 ANSI colors, each with a fixed text color on top, so they read
on dark and light themes. Nothing depends on color alone: a chip always carries
words, and marks are symbols (`✓`, `✗`, `❯`, `·`).

In `ork run` a node's chip leads each event of that node:

```
 RUN  run 5e0c9b2a of csv-export starts at builder

 builder  Splitting this into the exporter and its tests.
          Bash  ls test/
 tests    Write  test/csv.test.ts
 tests    ✓ pass: 6 tests for the CSV exporter · $0.4120

 OK  run 5e0c9b2a succeeded · $1.6154 · 2 ran, 0 skipped
```

A tool call is `Tool  first line`, cut at the screen width, with `+N lines` when
the call had more (a heredoc, a long script). A path inside the node's worktree
shows relative to it. The agent's own words wrap under a hanging indent. Add
`--verbose` to `ork run` (or `ork logs --verbose`) to show every call whole,
and, as before, a failed node's hint and details.

`ork ps`, `ork usage`, `ork feedback list`, `ork projects`, `ork worktrees`,
`ork watch --status`, `ork doctor` and `ork validate` use the same chips for
status (`OK`, `FAIL`, `WARN`, `SKIP`, a run's state), align their columns, cut
long values with `…` to fit the screen, and dim and indent hints.

## Plain output

Ork prints plain text, with no escape codes and no redrawn lines, when:

- the output is not a terminal (a pipe, a file, most CI logs);
- `NO_COLOR` is set;
- you pass `--plain` to any command, or set `ORK_PLAIN=1`;
- `TERM` is `dumb`.

Questions are then asked one line at a time, as before:

```
  1) ship (recommended)
  2) revise
  Choose [1]:
```

Type a number or an id; `Enter` alone takes the recommended option. A yes-or-no
question reads `Allow? [y/N] `. Plain output has no colored chips: a status is
the word or mark Ork always printed (`✓`, `-`, `succeeded`), and a chip that
remains is bracketed (`[MISSING]`). `--json`, where a command has it, still
prints data and not text.

**Use `--plain` with a screen reader.** Redrawn lines and arrow-key lists read
badly aloud; the line prompts and bracketed words read in order. Put
`export ORK_PLAIN=1` in your shell's profile to make it the default. Ork's
processes pass it on, so the sessions they start are plain too.

## Where it falls short

- A very narrow terminal (under 20 columns) is laid out as 20.
- Wide characters (CJK, emoji) count as one column, so a line can run a column
  long.
- A list with more options than the screen has rows does not scroll.
- Only tool lines are cut to the screen width; other run events wrap where the
  terminal wraps them.
- A live `ork chat` takes each message as a plain line, since replies print
  while it waits.
- Plain output has not been checked with a screen reader yet.
- A killed Ork (`kill -9`) can leave the cursor hidden; `reset` brings it back.

See also [running workflows](./running-workflows.md) for the transcript and
[tab completion](./tab-completion.md).
