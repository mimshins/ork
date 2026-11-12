# RFC-017 — One way to filter every list command

- **Status:** Accepted
- **Date:** 2026-11-13
- **Supersedes:** —
- **Superseded by:** —

## Context

Eight `ork` commands list things, and each filters in its own way or not at all.
Read from `packages/cli/src`:

| Command           | Filters today                                    | Also                               |
| ----------------- | ------------------------------------------------ | ---------------------------------- |
| `ps`              | `--all` (every project)                          | `--limit` (a bad value becomes 20) |
| `usage`           | `--since`, `--until`, `--workflow`, `--all`      | its own time parser, no `--limit`  |
| `decide --list`   | `--workflow`, run positional, `--all`            | `--list` and `--json` are separate |
| `follow-ups list` | `--for`, `--project`, `--all` (done and dropped) | no `--status`, no `--kind`         |
| `feedback list`   | `--all` (dismissed items)                        | none by kind, severity or workflow |
| `worktrees list`  | none                                             | `--json` only                      |
| `agents list`     | none                                             | `--json` only                      |
| `projects`        | none                                             | `--json` only                      |

Evidence: `commands/runs.ts` (`ps`), `commands/usage.ts` and `runs/usage.ts`,
`commands/decide.ts` and `commands/decide-list.ts`, `commands/follow-ups.ts`,
`commands/feedback.ts`, `commands/worktrees.ts`, `commands/setup.ts` (`agents`),
`commands/projects.ts`.

The cost shows in four places:

- **The same word means different things.** `--all` is "every project" on `ps`
  and `usage`, "dismissed too" on `feedback list`, and "done and dropped too" on
  `follow-ups list`.
- **The same filter is built twice.** `usage` parses `--since 30d` or a day in
  `runs/usage.ts`; no other list can take a time.
- **Scripting has no handle.** Nothing prints only ids for `$(...)`; a script
  scrapes the human table or parses all of `--json`.
- **Completion cannot help.** Values are offered by argument name
  (`completion/values.ts`: run, workflow, node, input, decide id, driver,
  shell). No status, kind or `--for` value is offered, and a wrong one is
  caught, if at all, by a hand-written check in each command.

The follow-up `cc84367e` (list filters) asks for the same. It could not be read
from this worktree (`ork follow-ups show cc84367e` finds nothing in this
project), so this RFC treats it as the `follow-ups list` row above and asks the
maintainer to confirm in Open questions.

The brief already fixes part of the answer: every list gets `--ids`
(comma-separated, for `$(...)`), `--limit` and `--json`, and filter values are
validated and Tab-completed from one field table per list. What is open is the
filter surface itself.

A fact that bears on the options: `follow-ups add --where <file>` already means
a file the follow-up is about (`commands/follow-ups-add.ts`, `FollowUp.where` in
`packages/core/src/follow-ups/types.ts`).

## Options

### Option A — Typed per-field flags, generated from one field table per list

Each list declares a field table: name, type, allowed values or a parser, and
how it matches. Flags such as `--status`, `--workflow`, `--since`/`--until`,
`--for`, `--kind` and `--project` are generated from it as citty flags, with
enum fields carrying `options`.

- **Pros:**
  - `--help` and Tab completion already read citty's definitions
    (`command-tree.ts` takes `options`, aliases and descriptions from them), so
    the flags show up in both with no new grammar.
  - The shell completes a flag's values the usual way; `providerFor` in
    `completion/values.ts` can take a field's values from the table.
  - Validation is per flag, with an error naming the flag and the allowed
    values, as `usage` does now for `--since` and `--by`.
  - One time parser (`--since`, `--until`) replaces `usage`'s private one.
  - Reads naturally: `ork ps --status failed --since 7d`.
- **Cons:**
  - A field with no flag cannot be filtered; every new filterable field is a
    table row.
  - No operators (`!=`, `>`, `~`) until a field's flag is extended.
  - More flags on `--help` of lists with many fields.

### Option B — A generic `--where field=value`

One repeatable flag; the field and value are checked against the table.

- **Pros:**
  - One flag on every list; any table field is reachable; operators
    (`field!=value`, `field>n`) can be added later with no new flag.
  - Smallest help text.
- **Cons:**
  - `--help` cannot say which fields a list has, short of a generated paragraph.
  - Tab completion needs a new grammar in `completion/position.ts`: field names,
    then that field's values after `=`; no shell completes `name=` pairs by
    default.
  - No citty enum validation; each error is Ork's own.
  - `--where` already means a file path on `follow-ups add`: one word, two
    meanings in the same command group.
  - `--where status=failed` is longer to type than `--status failed` for the
    filters people use daily.

### Option C — Both, from the same table

Typed flags for the common fields, and `--where` for the rest or for operators.

- **Pros:**
  - The typed flags stay the everyday path; `--where` is the escape hatch.
  - Fields rarely filtered need no flag.
- **Cons:**
  - Two spellings of one filter to document, validate and complete; which wins
    when both are given must be decided and explained.
  - The `--where` clash with `follow-ups add` stays.
  - If the table drives both, every field already has a typed flag, so `--where`
    adds only what the typed flags lack (operators), which no one has asked for.

## Decision

**Option A.** Every list command declares one field table, and its filter flags,
their validation and their Tab completion all come from it. There is no generic
`--where`. The table can drive a `--where` later with no change to the flags, if
operators or unflagged fields turn out to be needed.

Every list also gets the flags the brief fixed:

- `--ids`: only the ids, comma-separated, for `$(...)`.
- `--limit`: a positive integer; a bad value is an error, not a silent default.
- `--json`: as now.

Filter values are validated against the table (a wrong `--status` lists the
allowed ones), and the same table supplies the values Tab completion offers.

## Consequences

- **Positive:** one filter vocabulary across lists; one time parser; wrong
  values fail the same way everywhere; scripts get `--ids` instead of scraping;
  completion offers statuses, kinds and `--for` targets that it cannot offer
  today.
- **Negative:** a field with no flag cannot be filtered until a table row and a
  flag are added; `--all`'s three meanings must be settled (see Open questions);
  some current invocations change meaning or are replaced.
- **Specs and docs to update in the same change:** `specs/cli.md` (the command
  lines for `ps`, `usage`, `decide`, `feedback list`, `follow-ups list`,
  `worktrees`, `agents list`, `projects`), `specs/cli/completion.md`,
  `specs/follow-ups/surfaces.md`, `specs/cli/running-and-runs.md`, the guides in
  `docs/` that show those commands, and the interaction map if it shows the CLI
  surface.
- **Records:** an ADR when it ships; a changeset (shipped CLI behavior changes);
  an entry in `specs/gaps.md` for `--where` and operators, left out for now.
- **Tests:** a table test that every list's flags, validation and completion are
  derived from its table, so a new field cannot be added to one and not the
  others.
- **Rough shape of the tables** (a proposal to confirm in the plan, from the
  record types in `packages/core`): `ps` by status, workflow, project and the
  time a run started; `feedback list` by status, kind, severity, workflow and
  run; `follow-ups list` by status, `for`, kind, due and project;
  `decide --list` by workflow, run and project; `worktrees list` by run and
  project; `agents list` by where an agent comes from; `usage` by workflow,
  project and time. `projects` has no filter, only `--ids`, `--limit` and
  `--json`.

## Open questions

- **`--all`:** keep it as a shorthand with its current meaning per list, fold it
  into `--status all` and `--project all`, or remove it? Changing it breaks
  existing scripts and the specs that mention it.
- **Lists whose rows are not entities.** `usage` prints groups with no id, so
  `--ids` has nothing to print; `logs` prints events. Should `--ids` be refused
  on them, or left off? The brief says `logs` "where it fits", which this RFC
  reads as `--since`/`--until` and `--limit` on events, plus the `--node` it
  has.
- **Where the table lives.** In `packages/cli`, beside completion, it is the
  simplest. In `core` or `server`, the UI's list views and `ork mcp` could
  filter by the same table; the dependency direction allows both
  (`core <- server <- ui, cli`). Which is wanted now?
- **Filtering in the store.** Today `store.runs` takes only `limit` and
  `project`; `feedbackItems` takes `all`. Whether filters are pushed into the
  store queries or applied after reading is not decided here, and nothing was
  measured on how many rows a typical store holds.
- **Is `cc84367e` fully covered** by the `follow-ups list` fields above?
