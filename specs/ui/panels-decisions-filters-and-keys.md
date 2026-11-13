# Decisions: filters, keys and tokens

_Part of [The panels](./panels.md)._

Status: **Built**: the filter bar is the shared one
([design](./design-filter-bar.md)), which replaced the two selects and their
counts below. Extends
[Decisions: reading and filtering](./panels-decisions-readable.md), which holds
the card, Markdown, folding and the document dialog.

## Contents

- [The filter bar](#the-filter-bar)
- [Monitor control](#monitor-control)
- [Keys, names and copy](#keys-names-and-copy)
- [When `ork ui` is unreachable](#when-ork-ui-is-unreachable)
- [Tokens](#tokens)

## The filter bar

**Now** it is the shared [filter bar](./design-filter-bar.md) on the `decisions`
list, always shown: **Workflow** and **Run** as inputs with suggestions
(`4f2a1c · feature`, from the open decisions), and **Project** once there are
two to choose from, suggesting the registered projects (in name order) and the
projects of the runs with open decisions, as Runs does; with one project it
shows no Project field. A refused first filter shows the stream's open decisions
under the alert, not an empty panel. A filter is read from `GET /api/decisions`
with the fields (read again when the stream's list changes), keeps the last list
while a refused value shows the server's words, and says "3 decisions match."
aloud; a read that fails for any other reason (the network, a server error) also
keeps the last list and shows `Could not read decisions: <error>` as an alert
under the bar; with none set the panel shows the stream's open decisions and the
bar says how many are open. **Clear filter** and the matching
`ork decide --list` command show while one is set; a filter that leaves none
shows "No decisions match the filter." The `decisionFilter` preference keeps the
values; the Monitor button sets `{ run }`. A filter narrows the panel only: the
badge, notifications and `ork decide` count all. What follows is the earlier
two-select design, kept for its rules about the badge and the preference.

Above the cards, when the open decisions come from **more than one run**, or a
filter is set (so a stale one can always be cleared). Two selects, **Workflow**
and **Run**, in a row that wraps to two lines in a narrow panel (a container
query, as the panel's other rows).

- **Options:** "All" and each present value with its count of open decisions:
  `All (7)`, `feature (3)`, `review (4)`. The Run options are
  `4f2a1c · feature (2)`, limited to the chosen workflow (choosing a workflow
  clears a run that is not of it). Workflows and runs are sorted by name and by
  their oldest open decision.
- **Together:** the two combine with AND. A filter hides cards in the panel
  only: the badge, notifications and `ork decide` count all.
- **The count line**, under the bar, a polite status (`<output>`) so a change is
  said aloud: with a filter, "3 of 7 open decisions shown; 4 hidden by the
  filter." with **Clear filter** (a ghost button) after it; with none, "7 open
  decisions." One decision: "1 open decision.".
- **Kept per viewer:** the choice is the `decisionFilter` preference (below). A
  saved value that is not among the open decisions once the first list has come
  is dropped from the preference, so it never silently filters a later decision;
  the view shows All meanwhile. Nothing is dropped before the first list.
- **Empty with a filter:** the state is not "No decisions waiting." but a title
  "No decisions match the filter." and "4 open decisions are hidden by it. Clear
  the filter to see them." with **Clear filter**, and `cli`
  `ork decide --list --workflow feature` (the real values; a run adds its id).
  With no filter and no decisions, the state is as today.
- **The CLI twin** of the bar is `ork decide --list --workflow <workflow>` and
  `ork decide <run> --list`, shown as the selects' tooltips.

## Monitor control

A run in the Monitor with open decisions shows a ghost button in its header
beside the status, **2 decisions waiting** (`1 decision waiting`), with the
attention tone's icon beside the words, not color alone. It sets the run filter
to that run (clearing the workflow filter) and goes to the Decisions panel
(`workspace.goTo("decisions")`), moving the focus to the panel. Its tooltip:
"Open Decisions, filtered to this run." with `ork decide 4f2a1c --list`. Without
open decisions it is absent. It follows the count live and takes no key of its
own.

## Keys, names and copy

| Key / control       | Where                          | Does                                                                                                   |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `1` to `9`          | focus in the card, not a field | chooses that option, as before                                                                         |
| `Enter`             | on the card itself             | chooses the recommended option, as before                                                              |
| `Enter` / `Space`   | on Show all, Read, Copy, Close | acts, and **does not answer**: the card's key handler ignores a key from a button other than an option |
| `Tab`               | in the card                    | note, then each control in reading order: Show all, Read, links, options                               |
| arrows, Page, Space | in the document region         | scroll it                                                                                              |
| `Escape`            | in the dialog, a tooltip       | closes it; focus returns to its opener                                                                 |

Digits typed in the note stay in it. The fold, Read, copy and filter controls
take no digit key and no `aria-keyshortcuts`; the card handler also ignores a
digit from a `select`.

Names: the panel `Decisions`; the card as above (the question and context are
not regions); the filter selects `Workflow` and `Run`; the folded region's
button `Show all (62 lines)` / `Show less`; the dialog `approve · 7b3e` with
"Document for run 4f2a1c. Read-only."; the region `Document`; the Monitor button
`2 decisions waiting`.

Copy, exact:

- Buttons: `Read document`, `Show all (62 lines)`, `Show less`, `Close`,
  `Clear filter`, `Copy code (approve)`, `Copy command (approve)`,
  `2 decisions waiting`.
- Length after Read: `212 lines`, `1 line`.
- Status: `Copied.`, `Copy failed: select the text instead.` (the copy button's
  own).
- Fallback: `Could not render this as Markdown: showing the text as written.`
- Non-link target: `ADR-068 (decisions/ADR-068-document-field.md)`.
- Image: `image: diagram of the flow`.
- Failed read (not a refused value): `Could not read decisions: <error>`.

## When `ork ui` is unreachable

`isUnreachable(connection)`
([app-state.ts](../../packages/ui/src/state/app-state.ts): the stream is `lost`,
or the health check failed; not while first `connecting`) turns the open cards
read-only. The list stays as last received.

- **One notice per panel**, above the cards and only when a card is shown (the
  empty state already teaches `ork decide`): an alert icon and "Cannot answer
  here: `ork ui` is not reachable. Answer from a terminal with the command under
  each option." It is a plain paragraph, not a live region: the status bar
  already says the reason aloud. It never moves focus and leaves silently.
- **Each option** is `aria-disabled="true"` (not `disabled`, so it stays in the
  tab order, readable, with its tooltip), `data-unreachable`, flat and muted
  (the recommended option loses its amber surface; "recommended" stays), and
  shows its `ork decide` command on a line of its own, with the typed note in
  it. Its `aria-description` begins "Cannot answer here: ork ui is not
  reachable".
- **Keys:** a click, a digit or `Enter` on the card does nothing and sets no
  refusal. The note, **Open run** and the copy buttons stay enabled.
- When the server returns, the notice goes and the options answer again.

## Tokens

No new semantic tokens: text, muted text, link, strong border, sunken surface

and the focus ring are the existing pairings in
[pairings.ts](../../packages/ui/test/pairings.ts), which already cover them on
every surface (the card on `--surface-panel`, the dialog on `--surface-raised`,
a code block on `--surface-sunken`), so
[pairings.ts](../../packages/ui/test/pairings.ts) needs no change. Component
tokens, each declared on its base rule
([ADR-054](../../decisions/ADR-054-component-tokens.md)):

- `--markdown-*`: `text`, `muted`, `gap` (`--gap`), `list-indent`
  (`--space-16`), `quote-bar-color` (`--color-border-strong`), `quote-bar-width`
  (`--space-2`), `link-text` (`--color-link`), `inline-code-bg`
  (`--surface-sunken`), `heading-weight` (`--weight-strong`), `leading`
  (`--leading-ui`).
- `--folded-text-*`: `lines` (`20`), `max-height`
  (`calc(var(--fold-lines) * 1lh)`).
- `--decisions-document-*`: `bg` (`--surface-sunken`), `border-color`
  (`--color-border-strong`), `max-height` (`60vh`), `min-height` (`8lh`).
- `--decisions-filter-*`: `gap` (`--gap`), `field-min-width` (`10rem`), the
  count line's `text` (`--color-text-muted`) and `text-size` (`--text-small`).
- `--decisions-read-failed-*`: `text` (`--color-danger-text`), `text-size`
  (`--text-small`), `gap` (`--gap-tight`), `padding` (`--gap`).

Forced colors: the quote bar, a code block's edge and the document region's edge
take `CanvasText`, by token. Reduced motion: nothing animates in these pieces
(fold and dialog open without a transition beyond the dialog's opacity, which
the existing reduced-motion rule already removes).
