# List filters

_Part of [The ork CLI](../cli.md)._

Status: **Built**: one field table per list, and the flags, their checks,
`--ids` and Tab completion made from it, on `ork ps`, `usage`, `decide --list`,
`follow-ups list`, `feedback list`, `worktrees list`, `agents list`, `projects`
and (for time and `--limit`) `ork logs`
([machinery](../../packages/core/src/list-filters/types.ts),
[tables](../../packages/core/src/list-filters/tables.ts),
[flags](../../packages/cli/src/list/flags.ts),
[unknown flags](../../packages/cli/src/list/known-flags.ts),
[shared sentences](../../packages/core/src/list-filters/refusals.ts),
[output](../../packages/cli/src/list/print.ts),
[core tests](../../packages/core/test/list-filters.test.ts),
[flag tests](../../packages/cli/test/list-flags.test.ts)). The server's list
routes read the same tables, so the browser view's
[filter bar](../ui/design-filter-bar.md) and the `ork mcp` list tools filter by
the CLI's fields ([API](../server/api.md#list-routes)). Also built: the refusals
below (an unknown flag, one-line argument errors, a `--run` prefix, the `--for`
and `--project` checks, `live` in `ps --json`). Not built: a generic `--where`
and operators, store-side filtering ([L337, L338](../gaps.md#limits)), and the
unknown-flag check on commands that are not lists ([L359](../gaps.md#limits)).
Why: [RFC-017](../../rfcs/archived/RFC-017-list-filters.md) (Option A), and
[ADR-088](../../decisions/ADR-088-list-filters.md).

Eight commands list things. Each lists by one **field table**, and the same
words mean the same on every list: `--status`, `--project`, `--since`,
`--until`, `--workflow`, `--ids`, `--limit`, `--json`.

## Contents

- [The table](#the-table)
- [Field types](#field-types)
- [Flags every list takes](#flags-every-list-takes)
- [Order and defaults](#order-and-defaults)
- [Refusals](#refusals)
- [The lists](#the-lists)

## The table

The machinery lives in `@krapht/ork-core` so the CLI and the server, and with it
the UI and `ork mcp`, read the same tables.

- **`ListField`** is `name` (the flag), `description` (its help line), `type`,
  `values` (an enum's, in the order help and Tab show them), `all` (it takes
  `all` too) and `get`, which reads the row's value (or values: a feedback item
  has many runs). A field with no `get` only scopes the store read, as
  `--project` does; the command applies it.
- **`ListTable`** is the fields and `id`, what `--ids` prints. A list whose rows
  have no id (`usage`, `logs`) has none, and so has no `--ids`.
- **`parseFilters(table, given, now)`** checks each value and gives the filter,
  or the first error: ``--status takes one of a, b, c, not `x`.`` It names the
  flag and what it takes. `all` is a value only where the field says `all`.
- **`applyFilters(table, rows, filter)`** keeps the rows every given field
  matches, in their order. **`parseLimit`** is the `--limit` check.
- **A table's row type** decides where it is declared. Core's records have their
  tables in core (runs, feedback items, follow-ups, decisions, worktrees,
  usage); `agents list`, `projects` and `logs` are declared in the CLI with the
  same machinery. `usage`'s table only parses: `store.usage` already filters, so
  its values go straight into the `UsageFilter`.

The CLI makes each command's flags from its table: an enum field is a citty enum
flag, so `--help` and Tab completion read the values from its `options`, and
`all` is one of them where the field takes it.

## Field types

| Type    | Takes                                                     | Matches                               |
| ------- | --------------------------------------------------------- | ------------------------------------- |
| `enum`  | one of the field's values (and `all`, where it says so)   | the row's value, equal                |
| `text`  | any word                                                  | the row's value, equal                |
| `for`   | `agent`, `me`, `project:<name>` or `person:<name>`        | a follow-up's `for`, equal            |
| `since` | an age (`24h`, `30d`, `12w`), a day (`2026-11-01`), `all` | the row's time is not before it       |
| `until` | a day (`2026-11-01`), the last day it includes            | the row's time is before the next day |

A row with no value for a field never matches it.

**One time parser** serves `--since` and `--until` on every list, `ork usage`
and `ork logs` ([usage](../usage.md#ork-usage)); `ork prune --older-than` takes
its age from the same code. Hours are exact. Days and weeks are whole days
counting today, as in the Usage panel. A day is that day's start in the
machine's time zone, and a date that does not exist (`2026-13-45`) is refused.

## Flags every list takes

- **`--ids`** prints the ids comma-separated on one line (`id,id,id`), with no
  table and no decoration, and nothing for an empty result (exit 0). It is on a
  list whose rows have an id: `ps`, `decide`, `follow-ups list`,
  `feedback list`, `worktrees list` (what `worktrees remove` takes),
  `agents list` (the names) and `projects`. It is not on `usage` or `logs`.
  `--ids` with `--json` is an error. It is a handle for scripts:
  `ork resume $(ork ps --status failed --limit 1 --ids)`.
- **`--limit`** shows at most that many, after the filter and the list's order.
  It takes a positive whole number in digits; `0`, `-1`, `abc`, `2.5` and `1e21`
  are errors. Only `ork ps` has a default (20), and says so in `--help`; a
  script that wants every id passes `--limit` large, since `ps --ids` is limited
  too. `usage` has none.
- **`--json`** prints the rows as JSON; with `ps` they are the stored records
  plus `live`, the status the table shows (a running run whose process died says
  `crashed`); `status` stays as stored, so a script reading it is unaffected.
- **`--project`** (where a list spans projects: `ps`, `usage`, `decide`,
  `follow-ups list`, `worktrees list`) takes a registered project's id or root,
  or `all`; none is the project you are in. A project not registered is refused,
  listing the registered ones. `feedback list` has no `--project`: feedback is
  not kept per project.
- **`--status`** takes a status of that list, or `all`: the whole list, past the
  list's default. A wrong value lists the allowed ones.

A refusal says why on stderr, sets exit code 1 and prints no list.

## Order and defaults

**Order.** Filter, then the list's own order (newest first; due first, then
waiting, for follow-ups; oldest first for decisions), then `--limit`.

**Defaults keep what they were.** `ork ps` shows 20 runs of this project;
`ork usage` this project's last 30 days; `follow-ups list` the `due` and
`waiting` ones; `feedback list` hides `dismissed`. A filter narrows; an explicit
`--status all` or `--project all` widens. A follow-up `--status` shows what it
names, whatever its default, so `--status done` lists the closed ones.

**`--all` is gone** from `ps`, `usage`, `decide`, `follow-ups list` and
`feedback list` (it was `--project all` on the first three and `--status all` on
the other two). It gets no special message: it is an unknown flag, as below.
`prune --all`, `worktrees clean --all`, `relay list --all` and
`feedback export --all` are not lists and are unchanged.

## Refusals

A list says what is wrong in one line on stderr, exits 1 and prints nothing on
stdout.

- **An unknown flag** is refused on the nine list commands (`ps`, `logs`,
  `usage`, `decide`, `follow-ups list`, `feedback list`, `worktrees list`,
  `agents list`, `projects`): ``Unknown flag `--since`.`` (`-x` for a one-letter
  name). It is a citty plugin, `refuseUnknownFlags`, that runs before the
  command: citty's parser is not strict and turns an unknown `--since 24h` into
  `since: true` plus a positional, which `decide` would read as a run id. It
  skips `help`, `h`, the command's own flags with their aliases, and spellings
  (`run-id`, `runId`). It goes on leaf commands only: a parent such as
  `ork worktrees` sees its subcommands' flags as unknown, so
  `ork worktrees --bogus` and `wt` are not checked ([L359](../gaps.md#limits)).
  `projects` has subcommands (`forget`, `move`), so the plugin skips it when the
  first raw argument names one; `ork projects --bogus` is refused, but citty
  prints help before the message ([L362](../gaps.md#limits)). citty's `runMain`
  checks `instanceof` its own unexported `CLIError`, so the plugin takes one
  from a forced failed `parseArgs` and sets its message; a plain `Error` would
  print a stack.
- **One line, no help.** An argument error on any leaf command (a wrong enum
  value, a missing required flag, an unknown flag) prints only its message. Help
  prints for `--help` or `-h`, and for a group with no command or an unknown one
  (`ork follow-ups`, `ork nope`). The rule is the help printer `bin.ts` gives
  citty's `runMain`: it prints nothing for a command with no subcommands.
- **`--limit`** that is not a positive whole number written in digits:
  ``--limit takes a positive whole number written in digits, not `1e21`.``
  (core's `limitRefusal`; `0`, `-1`, `2.5` and `abc` read the same).
- **`--project`** that is not registered:
  ``No registered project `x`; registered: a, b.`` (`none` when there are none;
  core's `unknownProjectRefusal`). `ork mcp` says the same words.
- **`--run`** (`decide`, `feedback list`, `worktrees list`) takes a run id or a
  unique start of it and filters by the full id; an unknown or ambiguous run is
  refused with `findRun`'s message. One helper, `resolveRun`, serves all three.
- **`follow-ups list --for project:<name>`** is checked against the registered
  projects (a project's id is its name); `agent`, `me` and `person:<name>` are
  not.

## The lists

| List                  | Fields                                                           | `--ids`             |
| --------------------- | ---------------------------------------------------------------- | ------------------- |
| `ork ps`              | `status`, `workflow`, `project`, `since`, `until` (on its start) | run ids             |
| `ork usage`           | `workflow`, `project`, `since`, `until`                          | none                |
| `ork decide --list`   | `workflow`, `run`, `project`                                     | decision ids        |
| `ork follow-ups list` | `status`, `for`, `kind`, `due`, `project`                        | follow-up ids       |
| `ork feedback list`   | `status`, `kind`, `severity`, `workflow`, `run`                  | item ids            |
| `ork worktrees list`  | `run`, `project`                                                 | what `remove` takes |
| `ork agents list`     | `source` (`builtin`, `user`, `project`)                          | names               |
| `ork projects`        | none                                                             | project ids         |
| `ork logs`            | `since`, `until` (on each event's time), `--limit`               | none                |

- **`ps`** shows 20 runs unless `--limit` says another number; `--since` and
  `--until` match the run's start;
  `ork ps --status failed --workflow build --since 7d --limit 5 --project all`
  filters by all four and cuts to five. `--ids` is limited too
  ([L341](../gaps.md#limits)); `--json` prints the stored records and `live`.
- **`ps --status`** takes the stored status and the live ones `ps` shows:
  `running`, `paused`, `crashed`, `succeeded`, `failed`, `budget_exhausted`,
  `quota_exhausted`, `timed_out`, `interrupted`. A lock or slot wait is
  `running`, not a value. A running run's events are read only when `--status`
  is given.
- **`follow-ups list`**: `--due` takes `now`, `after-merge`, `after-deploy` or
  `date` (any dated one); `--kind` and `--status` take the follow-up values
  ([follow-ups](../follow-ups.md)); `--for` takes `agent`, `me`,
  `project:<name>` or `person:<name>`.
- **`feedback list`**: `--status` takes `new`, `triaged`, `accepted`,
  `dismissed`, `published`, `resolved`; `--kind` and `--severity` the feedback
  kinds and severities; `--workflow` and `--run` the items those runs reported.
- **`decide`**: `--ids` and `--limit` list instead of answering, on a terminal
  too, as `--json` and `--list` do; the run stays the positional (its flag name
  is `run-id`, shown as `[RUN-ID]` in `--help`; `--run` is the same filter).
- **Table details**: a field's `get` is optional (a scope-only field such as
  `project` has none, and `applyFilters` skips it) and may return an array (a
  feedback item holds several runs and workflows). `all` stays the literal
  `"all"` in a parsed filter, so a caller can tell `--status all` from an absent
  flag, which means the list's default. `--project all` reads every registered
  root in parallel (`inProjects`) and skips a root that is not a git repository,
  with a warning on stderr.
- **`logs`**: `--since` and `--until` keep the events whose time matches;
  `--limit` counts stored events (after the time and node filters), not output
  lines, keeps the last N of the replayed events and never cuts a live
  `--follow`; `--node` and `--json` are as before.
- **`usage`** has no `--ids` and no `--limit`; **`projects`** has only `--ids`,
  `--limit` and `--json`.

Tab completion offers a list's flags, an enum's values (`--status`, `--kind`,
`--severity`, `--due`, `--source`) from the citty options, and live values for
`--project`, `--for` and `--workflow` ([completion](./completion.md#values)). A
test walks every table and checks each field: the flag exists, an enum's options
equal the table's values, a wrong value is refused naming the flag and the
allowed values, and a `text` or `for` field has a completion provider. A
`since`, an `until` and `--limit` take a free value (an age, a day, a number),
so they have no provider and Tab completion offers nothing after them.
