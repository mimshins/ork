# The Builder, Logs and Decisions

_Part of [The panels](./panels.md)._

## Builder

Creates or edits a workflow with no YAML to write
([panel](../../packages/ui/src/builder/builder-panel.tsx),
[tests](../../packages/ui/test/builder),
[edits](../../packages/schema/src/workflow-edit.ts),
[server](../../packages/server/src/builder.ts),
[ADR-051](../../decisions/ADR-051-workflow-builder.md)). Its CLI twin is your
editor and `ork validate`.

- **Choosing:** a project, then one of its workflows or drafts, or a new name.
- **The palette** adds a node with a click or a key. It appears unconnected, in
  the first column, and takes its place when it's connected.
- **The canvas** is [the graph](./graph.md), so a workflow looks as it does in
  the Monitor. Nothing is dragged, and nothing about where a card sits is saved.
  A card's badge says its errors or warnings, or "not checked yet" while the
  file fails the format's own checks, as those stop the compiler from running.
- **The inspector** shows the selected node, or the workflow when none is
  selected. Forms come from the format's JSON Schema, so a new field needs no UI
  work: objects are groups, lists and named values are rows, and a union offers
  its kinds. A text field commits when it's left. A value the format leaves free
  (`mcp.call`'s `arguments`, `output.schema`, an input's `default`) is typed as
  text, or as JSON for a number or a list. There is no YAML to read or write.
- **A node that takes `forEach`** has a For each group: a choice of items
  written here or a list from an earlier node, a dropdown of those lists, and a
  way to declare one ([built](./panels-builder-for-each.md)).
- **A `watch:`'s `until`** is the same choice as an edge's condition, from what
  the node declares, except that waiting for it to fail isn't offered
  ([until-picker.tsx](../../packages/ui/src/builder/until-picker.tsx)).
- **Edges** are in the inspector: each with its condition and loop limit, added
  from a list or by picking a card, neither of which needs a drag.
- **Every change goes to the server,** which keeps it as a draft in the store
  and answers with the new text and what the checks say. Changes go one at a
  time and read what they build on when their turn comes, and an answer about a
  workflow no longer open changes nothing on screen. Undo steps back through
  this page's changes up to the last save, and Discard asks, then goes back to
  the file. Choosing another project closes what's open.
- **What's open outlives the panel:** the project, the workflow, the selected
  card and the undo steps are kept in the page's [state](./state.md), so moving,
  closing or stacking the panel shows them again.
- **Save** writes the workflow's file, whole, and never commits. Errors block
  it. If the file changed since the draft began, it asks before replacing it.
- **Run…** saves, says this is a real run, names the nodes that act outside the
  worktree, and opens the Run workflow dialog on it.

## Logs

The selected run's events, live
([panel](../../packages/ui/src/panels/logs-panel.tsx),
[tests](../../packages/ui/test/panels/logs-panel.test.tsx)). Its CLI twin is
`ork logs <run> --follow`, shown on the Follow button.

- **A row** has the event's time, node, type and a line in words. Opening it
  shows the whole event. The list is one tab stop: the arrow keys, `Home` and
  `End` move through it, and `Enter` opens a row. An opened event is one more
  stop, so the keys can scroll it. A `node.finished` that did not end well shows
  its end kind as a badge and Ork's sentence, and opened, its end note
  ([design](./design-components-and-copy.md#how-a-node-ended)) over the event.
- **Filters** are by node, by event type and by text anywhere in the event. The
  node filter is the shared selection, so choosing a node in the Monitor opens
  it here and the other way round. They look through what is loaded
  ([L65](./limits.md)). What they leave is said aloud once they stay still for
  half a second (WCAG 4.1.3).
- **A node with `forEach`** keeps its items with it: the filter `build` leaves
  the events of `build` and of `build.0`, `build.1`, … (the id plus `.` and
  digits, nothing else that merely starts with it), and `build.2` leaves that
  item's alone. The node's option reads "build and its items", an item's reads
  `build.2`, and the options sort numerically (`build.2` before `build.10`). The
  CLI twin is `ork logs <run> --node build`, which keeps the same. The node's
  own events are not available without its items. Built
  ([for-each](../scheduler/for-each.md)).
- **Following:** it stays on the newest. Scrolling up holds it, so what is being
  read stays still and the Follow button counts what is new; back at the end, or
  pressing it, follows again.
- **History:** the feed holds the newest 2000 events ([state](./state.md)), and
  **Load older** reads the next page before them, keeping what is on screen
  where it is.

## Decisions

Every open decision across runs, shaped like the question tool
([panel](../../packages/ui/src/panels/decisions-panel.tsx),
[tests](../../packages/ui/test/panels/decisions-panel.test.tsx)). Its CLI twin
is `ork decide`, and each option's tooltip gives `ork decide <run> --id <id>
--choose
<option>`.

- **A card** has where the question comes from, the question, its context, a
  note box and its options. The question, context and a gate's `document` are
  read as Markdown, folded past 20 lines, with filters and a Monitor shortcut
  ([built](./panels-decisions-readable.md), ADR-068, ADR-069); the settled list
  still shows plain text ([gaps](../gaps.md)). The recommended option says so in
  words, and stands out.
- **The note box**, labelled "Note for the run (optional)", two lines tall,
  takes what to send with the answer, the decision's
  [note](../messaging.md#decisions): a gate passes it on as `note`. Keys typed
  in it stay in it: `Enter` starts a new line and digits are text, so nothing is
  answered by accident. Once it has text, a copy-command block under it gives
  `ork decide <run> --id <id> --choose <option> --say '<note>'`, and each
  option's tooltip adds the same `--say`. A blank box sends no note.
- **An answer** takes one click. With the focus in the card (not in the note
  box), `1` to `9` choose an option, and `Enter` on the card itself takes the
  recommended one.
- **Nothing is optimistic:** the card stays until the server says it has settled
  on the stream, and a refusal stays in the card in the server's words. If the
  card had the focus, the focus moves to the next one, or to the panel after the
  last.
- **Settled** lists what has left the open list while the page watched, with who
  answered: in the run's terminal, with `ork decide` or in `ork ui`
  (`GET /api/decisions/:id`, [L66](./limits.md)), and "They said: …" under it
  when the answer had a note. Each is also said aloud.
