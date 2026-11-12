# ADR-088 — One field table per list, and the filter flags made from it

- **Status:** Accepted
- **Date:** 2026-11-13
- **Topic:** CLI, `packages/core` public exports, tab completion
- **RFC:** [RFC-017](../rfcs/archived/RFC-017-list-filters.md) (option A,
  accepted 2026-11-13); the plan "One way to filter every list command"

## Context

Eight `ork` commands list things (`ps`, `usage`, `decide --list`,
`follow-ups list`, `feedback list`, `worktrees list`, `agents list`,
`projects`), and each filtered in its own way or not at all. `--all` meant
"every project", "dismissed too" and "done and dropped too" on different lists;
only `usage` could take a time, with a parser of its own; a script had no handle
on ids short of scraping a table; and tab completion could not offer a status, a
kind or a `--for` target. Follow-up `cc84367e` (list filters) asked for the
same.

## Decision

- **One field table per list** (`ListTable`: its fields, each with a name, a
  type, its values, how a row's value is read, and what `--ids` prints). The
  flags, their validation, `--ids`/`--limit`/`--json` and the values Tab
  completion offers are all made from it, so a field added to a table shows up
  in all of them. No generic `--where` and no operators (`!=`, `>`, `~`); the
  tables can drive them later without changing the flags
  ([L333](../specs/gaps.md#limits)).
- **The machinery and the tables for the record types that live in core are in
  `packages/core`** (`list-filters/`, exported from `@krapht/ork-core`): the
  field and table types, `parseFilters`, `applyFilters`, `parseLimit`, the one
  time parser (moved from `ork usage`), and the tables for runs, feedback items,
  follow-ups, decisions, worktrees and usage. This is a new public export of
  core, so the UI and `ork mcp` can read the same tables later
  ([L335](../specs/gaps.md#limits)). A list whose row type lives only in the CLI
  (`agents`, `projects`, `logs`) declares its table in the CLI with the same
  machinery. The CLI makes citty flags from a table (`packages/cli/src/list/`),
  an enum field's values as citty `options`, which `--help` and completion
  already read.
- **`--all` is folded into `--project all` and `--status all`.** It stays one
  release as a hidden deprecated alias (an `Internal:` flag, left out of help
  and completion) that prints one line on stderr naming the replacement; when
  both are given the new flag wins and the warning still prints. `prune --all`
  is not a list and is unchanged. Removing the alias is a later change.
- **Flags exist only where they mean something.** `--ids` is on a list whose
  rows have an id, so not on `usage` (groups) or `logs` (events); `ork projects`
  has only `--ids`, `--limit` and `--json`. `--ids` with `--json` is an error;
  `decide --ids` and `--limit` list instead of answering.
- **`--limit` is a positive whole number**; `0`, `-1`, `abc` and `2.5` are
  errors, not a silent default. `ps` keeps its default of 20; no other list has
  one.
- **Filters apply after the store read**, then the list's own order, then
  `--limit`. Nothing was measured on a large store
  ([L334](../specs/gaps.md#limits)).

## Options considered

- **A generic `--where field=value`.** One flag on every list, and operators
  could be added with no new flag. But `--help` cannot say which fields a list
  has, completion needs a new grammar for `name=` pairs, there is no citty enum
  check, and `--where` already means a file on `follow-ups add`.
- **Both, from one table.** Two spellings of one filter to document, validate
  and complete, and the `--where` clash stays; `--where` would add only
  operators, which nobody asked for.
- **Tables in `packages/cli` only.** Simplest, but the UI and `ork mcp` could
  not filter by the same fields without moving them.
- **Removing `--all` at once.** Breaks scripts with no warning.

## Rationale

Typed flags are what `--help` and completion already read, error messages name
the flag and the allowed values, and `ork ps --status failed --since 7d` is
shorter than a `--where` form for the filters people use daily. A table in core
costs one export and lets other surfaces reuse it.

## Consequences

- One vocabulary across eight lists, one time parser, and
  `$(ork ps --status failed --ids)` in a script. A field with no table row
  cannot be filtered until one is added.
- Scripts that use `--all` keep working for one release, with a warning.
- `ps --ids` is limited to 20 by default; `--limit` raises it
  ([L337](../specs/gaps.md#limits)).
- A test derived from the tables keeps every list's flags, validation and
  completion in step with its table.
- Left simpler, in the [register](../specs/gaps.md): `--where` and operators
  (L333), filtering in the store (L334), the UI and `ork mcp` not reading the
  tables (L335), the deprecated `--all` (L336), the `ps --ids` default (L337).
- Follow-up `cc84367e` is covered by the `follow-ups list` fields.

Spec: [List filters](../specs/cli/list-filters.md); guide:
[Filtering lists](../docs/guides/filtering-lists.md).
