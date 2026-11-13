# The list filter bar

_Part of [Design system](./design-system.md)._

Status: **Built** ([bar](../../packages/ui/src/components/filter-bar.tsx),
[its fields](../../packages/ui/src/components/filter-field.tsx),
[input](../../packages/ui/src/components/filter-input.tsx),
[notes and empty state](../../packages/ui/src/components/filter-notes.tsx),
[model](../../packages/ui/src/components/filter-model.ts),
[hook](../../packages/ui/src/state/list-fields.ts),
[tests](../../packages/ui/test/components/filter-bar.test.tsx)), on all six list
panels; the keyboard and screen-reader checks ran in jsdom and axe only.
[RFC-017](../../rfcs/archived/RFC-017-list-filters.md),
[ADR-088](../../decisions/ADR-088-list-filters.md); it closed a limit of the
[register](../gaps.md#limits). The server side is
[`contract-lists.ts`](../../packages/server/src/contract-lists.ts) and
`GET /api/list-fields`; the CLI's side is
[list filters](../cli/list-filters.md).

## Contents

- [Purpose](#purpose)
- [Controls, by field type](#controls-by-field-type)
- [States](#states)
- [Layout, keys and names](#layout-keys-and-names)
- [Copy](#copy)
- [Component contract](#component-contract)
- [Per panel](#per-panel)
- [Tokens](#tokens)

## Purpose

One bar, on all six list panels (Runs, Decisions, Follow-ups, Feedback,
Worktrees, Usage), made from the list's field table as `GET /api/list-fields`
sends it: the UI shows the CLI's fields, with the CLI's names and values, so a
filter set here is the same words as the flags. A change refetches the list with
those query params; the server checks every value and answers with the CLI's
words. The panels keep their own defaults, and the bar says when one applies.

## Controls, by field type

Each field is a label above its control, in the table's order, labelled with the
flag's name in sentence case: **Status**, **Workflow**, **Project**, **Since**,
**Until**, **Kind**, **Severity**, **Due**, **For**, **Run**. The table's
`description` is the control's accessible description and shows as a `Tip` on
hover and focus, verbatim, so the UI never rewords the CLI's help.

| Field `type`     | Control                | Takes                                                                         |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `enum`           | `Select`               | the table's `values`, verbatim (`budget_exhausted`, `after-merge`), in order  |
| `text`, `for`    | input with suggestions | free text, applied on commit; suggestions are optional help, never a limit    |
| `since`, `until` | input with suggestions | an age (`24h`, `30d`), a day (`2026-11-01`), and `all` where the table has it |

- **A select's first option** is the unset value. With a panel default for the
  field it reads `Default (not dismissed)`; without, `Any`. A field with `all`
  and a panel default adds **All** last, which widens past that default. A field
  with `all` and no default gets no **All** (it would equal `Any`).
- **An input** is built on Base UI's `Autocomplete` (free text with a list; the
  `Combobox` only picks). Its placeholder is `Default: 30d` when the panel has a
  default for it, otherwise an example: `workflow name`, `run id or prefix`,
  `id, root or all`, `agent, me, project:name`, `24h, 30d or 2026-11-01`,
  `2026-11-01`.
- **Suggestions** are an option's `value` (what is applied) with a `label`
  (`4f2a1c · feature`, no counts): the panel's, plus built-in ones: `since`
  offers `24h`, `7d`, `30d`, `90d` (and `all`); `for` offers `agent`, `me`;
  `project` offers `all`. The `project` field is hidden unless the panel gives
  two or more projects or one is set, as Follow-ups' Project select was.
- **Applied on commit,** not while typing: Enter, leaving the field, or choosing
  a suggestion. An empty value unsets the field; the value is trimmed. A select
  applies on change.

## States

| State           | What shows                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields loading  | "Reading filters…" as a polite status in place of the fields; the list reads as it does today.                                                                                                                                                                                                                |
| Fields failed   | An alert: "Couldn't read the filter fields: <server's words>. The list shows without filters." with **Try again** and the list's `--help` command as a block. The list stays usable.                                                                                                                          |
| No filter       | The fields, none set. The panel's `summary` (such as "3 due, 5 waiting") is the status line. No **Clear filter**, no command.                                                                                                                                                                                 |
| Filtered        | The count line says "3 runs match." (`<output>`, polite); **Clear filter** and the matching `ork` command as a block (below) appear.                                                                                                                                                                          |
| Refetching      | The count line says "Updating…"; the fields stay enabled and the list stays as it was until the answer.                                                                                                                                                                                                       |
| Value refused   | HTTP 400: an alert under the fields with the server's words and "The list shows the last filter that worked. Fix the value, or clear the filter." The named field is `aria-invalid`, its border takes the danger text color, and the alert is its description. The list keeps its last good rows, not dimmed. |
| Nothing matches | The panel's empty state: "No runs match the filter." with **Clear filter** and the command as `cli` (see [Copy](#copy)). With no filter set, the panel's own empty state.                                                                                                                                     |
| Unreachable     | The fields stay as last read. A refetch that cannot reach `ork ui` is the panel's own read failure, not the bar's.                                                                                                                                                                                            |

**A first refused filter** (no filter has worked yet) shows the panel's
unfiltered list under the alert, never a blank list or "Reading runs…". The same
rule holds before the first filtered answer arrives: the list stays as it was
(the unfiltered one) until the answer, as in Refetching. A list that is empty
because it was never filtered or because the filter was refused shows the
panel's own empty state, not "No runs match the filter." (that one is for an
accepted filter that matches nothing). The alert's words are unchanged: the
unfiltered list is the last filter that worked.

**The command follows the filter that worked.** While the server refuses
`values`, the shown and copied command is the last values it accepted (the
**applied** values), so the bar never offers a command the CLI would also
refuse. With no accepted filter yet it is the list's plain command (`ork ps`).
**Clear filter** and the Filtered state still follow `values`, so a refused
filter can be cleared; clearing makes `{}` the applied values.

Counts are not read for the hidden rows: the filtered route answers only what
matches, so the bar never says how many a filter hides, and a select's options
carry no counts. (Decided: shown-only.)

## Layout, keys and names

- **Where:** in the panel's tools card or tools row, first, so the filter reads
  before the panel's own actions (Reload, Run workflow). A wrapping row; each
  field `--filter-bar-field-min-width` wide, `since` and `until` narrower. In a
  container below 28rem the fields stack one per line, label above, full width.
  At 200% zoom it stacks; nothing is cut or scrolls sideways.
- **Focus order:** the fields in the table's order, **Clear filter**, the
  command's copy button, then the panel's own tools. The alert, count line and
  command text are not tab stops, and an error never moves focus.
- **Keys** (none is a single-letter shortcut, and no field has
  `aria-keyshortcuts`; a panel's list keys (arrows, Home, End, digits) ignore
  keys that come from a field in the bar):

| Key                      | Where        | Does                                                                        |
| ------------------------ | ------------ | --------------------------------------------------------------------------- |
| `Enter`, `Space`, arrows | a select     | opens it; arrows choose; type-ahead works; `Enter` applies, `Escape` closes |
| `Enter`                  | an input     | takes the highlighted suggestion if any, else applies the typed text        |
| `ArrowDown`, `ArrowUp`   | an input     | opens the suggestions and moves through them; focus stays in the input      |
| `Escape`                 | an open list | closes it. With it closed, restores the field to its last applied value     |
| `Tab`                    | an input     | applies the typed text and moves on                                         |

- **Clear filter** resets every field and drops any pending text, even when
  focus left a field by clicking it. Focus then goes to the first field (the
  button is gone), and the count line says "Filter cleared."
- **Names:** the bar is `role="search"` named `Filter runs` (`Filter decisions`,
  `Filter follow-ups`, `Filter feedback`, `Filter worktrees`, `Filter usage`);
  each field is named by its label, and described by the table's description and
  by the alert when it is the invalid one; **Clear filter** keeps its visible
  words, with the list's plain command as its CLI twin (`ork ps`); the copy
  button is `Copy command (ork ps --status failed)`.
- **Announcements:** only the polite count `<output>` and the one alert speak:
  "3 runs match.", "Updating…", "Filter cleared.", the alert's text. A commit
  that changes nothing says nothing. No status rests on color: the alert has its
  icon and words, the invalid field its `aria-invalid` and the alert text.

## Copy

Exact. Nouns: `runs`, `decisions`, `follow-ups`, `feedback items`, `worktrees`,
`usage rows`; the singular is `run`, `decision`, `follow-up`, `feedback item`,
`worktree`, `usage row`.

- Count line: `3 runs match.`, `1 run matches.`, `No runs match.`, `Updating…`,
  `Filter cleared.`
- Buttons: `Clear filter`, `Try again`.
- Status: `Reading filters…`.
- Fields failed:
  `Couldn't read the filter fields: <server's words>. The list shows without filters.`
- Refused:
  `<server's words> The list shows the last filter that worked. Fix the value, or clear the filter.`
  The server's words are Ork's own, so they go through `CodeText`:
  ``--status takes one of …, not `x`.``
- Empty state: title `No runs match the filter.`, body
  `Clear the filter to see the default list.`, **Clear filter**, and `cli` the
  matching command.
- **The command twin** is built by the pure helper `filterCommand(list, values)`
  (the bar passes `values` when the server accepts them, else the applied
  values; see [States](#states)): `ork ps`, `ork usage`, `ork decide --list`,
  `ork follow-ups list`, `ork feedback list`, `ork worktrees list`, then each
  set field as `--name value` in the table's order (a value with a space or
  shell character is quoted). A panel default is never written as a flag. It
  shows as a `CopyCommand` block under the fields **only while filtered**, and
  as the empty state's `cli`. The failed-fields block is the list's `--help`
  (`ork ps --help`).
- Field help lines are the table's, unchanged. Placeholders are above.

## Component contract

`FilterBar` and `FilterEmpty` live in `src/components/`, with a CSS module on
the tokens, a keyboard test and an axe test. The fields come from
`useListFields()` in `src/state/`: one `GET /api/list-fields` read per page,
shared by the six bars, answering
`{ status: "loading" | "failed" | "ready", fields, error, retry }` (`retry` is
**Try again**'s action).

```ts
type FilterValues = Partial<Record<string, string>>; // absent = unset

type FilterBarProps = {
  /** Picks the table's fields, the nouns, the command and the bar's name. */
  list: ListName;
  /** The applied values, as the query sent. */
  values: FilterValues;
  /** The whole next record, empties removed; called on commit and on clear. */
  onChange: (next: FilterValues) => void;
  /** The server's 400 for `values`. `field` is read from its leading `--name`. */
  error?: { message: string; field?: string } | null;
  /** A refetch is in flight. */
  busy?: boolean;
  /** Rows the filtered list shows; null before the first read. */
  shown?: number | null;
  /** The panel's status line while unfiltered ("3 due, 5 waiting"). */
  summary?: string;
  /** The panel's default for a field, in its words ("not dismissed"). */
  defaults?: Partial<Record<string, string>>;
  /** Extra suggestions for `text`, `for` and `project` fields, no counts. */
  suggestions?: Partial<
    Record<string, readonly { value: string; label: string }[]>
  >;
};

type FilterEmptyProps = {
  list: ListName;
  values: FilterValues;
  onClear: () => void;
};
```

`isFiltered(values)` (any value set) and `filterCommand(list, values)` are
exported pure functions, tested without React. The bar owns the drafts of
uncommitted inputs, the count line and the command, and remembers the last
`values` the server accepted (those with no `error` and no `busy`, derived
during render as `useFilteredRuns` does); the panel owns the current `values`,
the fetch and the 400.

## Per panel

Each panel's model passes its `list`; the bar goes first in its tools. Defaults
and suggestions are the panel's, and the filter lasts for the page's life unless
noted.

| Panel      | `defaults`                          | `suggestions`                                          | Notes                                                                                                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Runs       | the panel's current project         | `project`: registered projects and those of runs shown | still the 20 newest; `status` values include `paused` and `crashed`, the live statuses its rows show                              |
| Decisions  | none                                | `workflow`, `run` (`4f2a1c · feature`), `project`      | the bar always shows; the `decisionFilter` preference keeps its values; the Monitor button sets `{ run }`; no "hidden" count      |
| Follow-ups | `status`: `open`                    | `for`: each `project:<name>`, `person:<name>` present  | the old Status `Open` is `Default (open)`; a saved `open` is read as unset; the summary stays                                     |
| Feedback   | `status`: `not dismissed`           | `workflow`, `run`                                      | its **About** select (`ork`, `workflow`, `project`) is not a table field: it stays beside the bar, unchanged                      |
| Worktrees  | the panel's current project         | `project`                                              | cards still group by project                                                                                                      |
| Usage      | `since`: `30d`; the panel's project | `project`                                              | replaces the 7, 30, 90 days or all select: `since` offers those as built-in suggestions; a saved `7` or `all` maps to `7d`, `all` |

## Tokens

No new semantic token and no new pairing in
[pairings.ts](../../packages/ui/test/pairings.ts): the bar uses `--color-text`,
`--color-text-muted`, `--color-danger-text` (already paired on every surface, so
the alert text and the invalid border pass 4.5:1 and 3:1), `--surface-sunken`,
`--color-border-strong` and `--color-focus`. Component tokens, declared on the
bar's base rule ([ADR-054](../../decisions/ADR-054-component-tokens.md)), a
state only setting tokens: `--filter-bar-*`: `gap` (`--gap`), `row-gap`
(`--gap-tight`), `field-min-width` (`10rem`), `field-narrow-width` (`7rem`, for
`since`, `until`), `count-text` (`--color-text-muted`), `count-text-size`
(`--text-small`), `error-text` (`--color-danger-text`), `field-invalid-border`
(`--color-danger-text`). The 28rem stack point is a container query, as the
panels' other rows. Controls keep the 24×24 target and `--control-height`; no
text under 11 px. Forced colors: the invalid border keeps `ButtonText` and the
alert's icon and words carry the state. Reduced motion: nothing animates beyond
the popup's existing opacity.
