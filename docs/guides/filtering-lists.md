# Filtering lists

Every `ork` command that lists things filters the same way: the same flag means
the same thing on each, a wrong value is refused with the allowed ones, and
`--help` and [Tab completion](./tab-completion.md) show them. A flag a list
doesn't have is refused too (``Unknown flag `--since`.``), so a typo never
quietly lists everything, and a refusal prints that one line, not the help.

```sh
ork ps --status failed --workflow build --since 7d --limit 5 --project all
ork follow-ups list --for agent --kind change --due after-merge
ork feedback list --severity high --kind bug
ork decide --list --workflow feature
```

## What each list takes

| Command               | Filters                                                     |
| --------------------- | ----------------------------------------------------------- |
| `ork ps`              | `--status`, `--workflow`, `--project`, `--since`, `--until` |
| `ork usage`           | `--workflow`, `--project`, `--since`, `--until`             |
| `ork decide --list`   | `--workflow`, `--project`, `--run`                          |
| `ork follow-ups list` | `--status`, `--for`, `--kind`, `--due`, `--project`         |
| `ork feedback list`   | `--status`, `--kind`, `--severity`, `--workflow`, `--run`   |
| `ork worktrees list`  | `--run`, `--project`                                        |
| `ork agents list`     | `--source` (`builtin`, `user` or `project`)                 |
| `ork projects`        | none                                                        |
| `ork logs`            | `--since`, `--until`, and `--node` as before                |

Every list but `usage` and `logs` also takes `--ids`, and every one but `usage`
takes `--limit`; all take `--json`, except that `ork logs` keeps the flags it
had. `ork run`'s `--help` is not affected. Filters narrow: give several and a
row must match all of them.

- **`--project`** is a registered project's id or root, or `all`. Without it, a
  list is about the project you are in. A project that isn't registered is
  refused, with the registered ones named.
- **`--run`** (`decide`, `feedback list`, `worktrees list`) is a run's id or the
  start of it; a start that matches no run, or more than one, is refused.
- **`--status`** is one of the list's statuses, or `all`. For `ork ps` it is a
  run's status, including `paused` and `crashed` (a run that died without saying
  so); a run waiting for a slot or a lock is still `running`.
- **`--for`** on follow-ups is `agent`, `me`, `person:<name>` or
  `project:<name>`; a project that isn't registered is refused.

Two lists hide some rows until you ask. `ork follow-ups list` shows the `due`
and `waiting` ones, and `--status all` adds `done` and `dropped`.
`ork feedback list` hides dismissed items, and `--status all` shows them. A
`--status` you name shows exactly that status.

## Times

`--since` and `--until` take one of:

- an **age**: `24h`, `30d` or `12w`. Days and weeks count whole days, today
  among them; hours are exact.
- a **day**: `2026-11-01`, in your machine's time zone. `--until 2026-11-01`
  includes that whole day.
- `all`, for `--since` only: no start.

`ork usage` reads them the same way, and `ork logs` matches each event's time.

## Counting and printing

- **`--limit N`** shows at most `N` rows, after filtering and in the list's own
  order (newest first, or due first for follow-ups). It is a positive whole
  number written in digits: `0`, `-1`, `2.5`, `1e21` and `abc` are refused. Only
  `ork ps` has a default, 20; the others show everything. On `ork logs`,
  `--limit` keeps the last `N` of the events it replays and doesn't cut a live
  `--follow`.
- **`--json`** prints the rows as JSON. `ork ps --json` adds `live` to each: the
  status `ork ps` shows, so a run that died without saying so is `crashed`
  there, while `status` stays as stored.
- **`--ids`** prints only the ids, comma-separated on one line, with no table
  and no decoration. An empty result prints nothing and exits 0. It cannot be
  combined with `--json`.

`--ids` is for scripts:

```sh
for run in $(ork ps --status running --ids | tr , " "); do ork stop "$run"; done
for item in $(ork feedback list --kind friction --ids | tr , " "); do ork feedback dismiss "$item"; done
```

Mind the default: `ork ps` shows 20 runs, so `ork ps --ids` prints at most 20
ids. Add `--limit 500` for more. A bare `ork decide` answers questions; with
`--ids` or `--limit` it lists instead, on a terminal too, so a script never
starts answering by accident.

## In the browser and `ork mcp`

The browser view's six list panels (Runs, Decisions, Follow-ups, Feedback,
Worktrees and Usage) have a filter bar built from the same tables, so a filter
set there is the same words as the flags: a select for a field with fixed values
(`--status`, `--kind`, `--severity`, `--due`), an input for the rest
(`--workflow`, `--run`, `--project`, `--for`, and `--since` and `--until`, which
take an age such as `24h` or a day such as `2026-11-01`). **Project** shows once
more than one project is registered. A value is applied when you press `Enter`,
leave the field or choose a suggestion; a wrong one shows the CLI's message
under the bar and the list keeps the last filter that worked (the unfiltered
list, if none has). While a filter is set the bar shows the matching command,
for a terminal (the last one that worked, never the refused one), and **Clear
filter**. A panel keeps its own default (follow-ups: open; feedback: not
dismissed; usage: the last 30 days), shown in the field until you set one.

The `runs`, `usage` and `decisions` tools of `ork mcp` take the same fields, and
a model asking for `status: "crashed"` or `since: "24h"` gets the CLI's words
when it is wrong, and so does one that names a `project` that isn't registered
or a `limit` that isn't a positive whole number.

## `--all` is removed

`ps`, `usage`, `decide`, `follow-ups list` and `feedback list` no longer take
`--all`; it is refused like any unknown flag. Use `--project all` (`ps`,
`usage`, `decide`, `follow-ups list`) or `--status all` (`follow-ups list`,
`feedback list`). `ork prune --all`, `ork worktrees clean --all`,
`ork relay list --all` and `ork feedback export --all` are not lists and keep
it.

The exact rules: [List filters spec](../../specs/cli/list-filters.md).
