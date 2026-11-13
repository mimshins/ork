# List filters

_Part of [The ork CLI](../cli.md)._

Status: **Built**: one field table per list, and the flags, their checks,
`--ids` and Tab completion made from it, on `ork ps`, `usage`, `decide --list`,
`follow-ups list`, `feedback list`, `worktrees list`, `agents list`, `projects`
and (for time and `--limit`) `ork logs`
([machinery](../../packages/core/src/list-filters/types.ts),
[tables](../../packages/core/src/list-filters/tables.ts),
[flags](../../packages/cli/src/list/flags.ts),
[output](../../packages/cli/src/list/print.ts),
[the `--all` alias](../../packages/cli/src/list/all-alias.ts),
[core tests](../../packages/core/test/list-filters.test.ts),
[flag tests](../../packages/cli/test/list-flags.test.ts)). The server's list
routes read the same tables, so the browser view's
[filter bar](../ui/design-filter-bar.md) and the `ork mcp` list tools filter by
the CLI's fields ([API](../server/api.md#list-routes)). Not built: a generic
`--where` and operators, and store-side filtering
([L337, L338](../gaps.md#limits)). Why:
[RFC-017](../../rfcs/archived/RFC-017-list-filters.md) (Option A), and
[ADR-088](../../decisions/ADR-088-list-filters.md).

Eight commands list things. Each lists by one **field table**, and the same
words mean the same on every list: `--status`, `--project`, `--since`,
`--until`, `--workflow`, `--ids`, `--limit`, `--json`.

## Contents

- [The table](#the-table)
- [Field types](#field-types)
- [Flags every list takes](#flags-every-list-takes)
- [Order, defaults and `--all`](#order-defaults-and---all)
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
  It takes a positive whole number; `0`, `-1`, `abc` and `2.5` are errors. Only
  `ork ps` has a default (20), and says so in `--help`; a script that wants
  every id passes `--limit` large, since `ps --ids` is limited too. `usage` has
  none.
- **`--json`** prints the rows as JSON; with `ps` they are the stored records.
- **`--project`** (where a list spans projects: `ps`, `usage`, `decide`,
  `follow-ups list`, `worktrees list`) takes a registered project's id or root,
  or `all`; none is the project you are in. A project not registered is refused,
  listing the registered ones. `feedback list` has no `--project`: feedback is
  not kept per project.
- **`--status`** takes a status of that list, or `all`: the whole list, past the
  list's default. A wrong value lists the allowed ones.

A refusal says why on stderr, sets exit code 1 and prints no list.

## Order, defaults and `--all`

**Order.** Filter, then the list's own order (newest first; due first, then
waiting, for follow-ups; oldest first for decisions), then `--limit`.

**Defaults keep what they were.** `ork ps` shows 20 runs of this project;
`ork usage` this project's last 30 days; `follow-ups list` the `due` and
`waiting` ones; `feedback list` hides `dismissed`. A filter narrows; an explicit
`--status all` or `--project all` widens. A follow-up `--status` shows what it
names, whatever its default, so `--status done` lists the closed ones.

**`--all` is deprecated.** It meant "every project" on `ps`, `usage` and
`decide` and "the closed ones too" on `follow-ups list` and `feedback list`. It
now stands for `--project all` on the first three and `--status all` on the
other two, prints `--all is deprecated; use --project all.` (or `--status all`)
once on stderr, and is left out of `--help` and Tab completion (its description
starts `Internal:`). When both `--all` and the new flag are given the new flag
wins, and the warning still prints. A later release removes it
([L340](../gaps.md#limits)). `ork prune --all` is not a list and is unchanged.

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
  ([L341](../gaps.md#limits)); `--json` prints the stored records.
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
