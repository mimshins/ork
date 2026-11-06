# The panels

_Part of [The UI](../ui.md)._

Status: **Built:** the Runs panel, the Run workflow dialog, the Monitor, the
Builder, Logs, Decisions, Chats, Notifications, Usage and Context
([panels](../../packages/ui/src/panels/),
[tests](../../packages/ui/test/panels/)).

## Contents

- [Runs](#runs)
- [Run workflow](#run-workflow)
- [Monitor](#monitor)
- [Builder](#builder)
- [Logs](#logs)
- [Decisions](#decisions)
- [Chats](#chats)
- [Notifications](#notifications)
- [Usage](#usage)
- [Context](#context)

## Runs

The newest 50 runs from the [overview stream](./state.md#the-containers),
filtered by project ([L37](../gaps/limits.md)).

- **A row** has the workflow and its status, as an icon and a word; then the
  run's id, when it started, what it cost, and how many nodes are paused. A
  running run with an open decision reads "waiting on you".
- **Choosing a row** selects the run for the other panels. The selected row has
  a line down its edge as well as its color.
- **Keys:** the list is one tab stop. The arrow keys, Home and End move through
  it, and Enter or Space chooses.
- **The filter** lists the registered projects, and the projects of the runs
  shown, which may be unregistered by now.
- **Rendering:** a row re-renders only when its own run changes
  ([what re-renders](./state.md#what-re-renders)).

The empty state teaches the next step: **Run workflow** or `ork run <workflow>`.

**Triggers,** under the list when any registered project has some, say how each
stands, from [`GET /api/triggers`](../server.md#api): whether it's live and when
it last looked, or why it's off, with `ork watch --accept` as the way to change
that. It only shows: accepting takes a terminal
([trust](../scheduler/watching.md#trust)).

## Run workflow

Opened from the panel's button or the palette, so it works with the panel
closed.

- **Project and workflow** come from one-off reads each time it opens. With only
  one to choose from, it is chosen. Typing filters the list and highlights the
  first match, for Enter to take. The workflow field waits for a project and
  says so, and a project with no workflows, or whose workflows cannot be read,
  says that as the reason it cannot start.
- **Inputs** follow the workflow's declarations: a checkbox for a boolean, a
  number field for a number, and a text field otherwise, with each one's
  description.
- **Flags** are `--driver`, `--in-place` and `--allow-dirty`. They are here
  because the server may refuse a run without one, and the dialog must not be a
  dead end.
- **The CLI twin** is shown as it is filled in, ready to copy. It leaves out
  inputs at their default and quotes what a shell would split.
- **Start run** is disabled until the form can start, and the reason is shown
  beside it and said aloud as it changes. A workflow that does not parse cannot
  start; its error is the reason.
- **After starting,** the dialog selects the new run, closes and shows a toast.
  The run arrives on the stream like any other, about a second later: nothing is
  added to the list in advance. The focus goes to its heading once the Monitor
  shows it, since what opened the dialog may have gone with the run chosen
  before ([L69](../gaps/limits.md)). A refusal stays in the dialog, in the
  server's words.

Escape on a combobox with its list closed clears it, as the ARIA pattern allows,
so a second Escape closes the dialog. Workspace keys wait while a dialog is open
([workspace](./workspace.md#keys)).

## Monitor

The selected run, live ([panel](../../packages/ui/src/panels/monitor-panel.tsx),
[tests](../../packages/ui/test/panels/monitor-panel.test.tsx),
[accessibility tests](../../packages/ui/test/panels/monitor-access.test.tsx)).
Its CLI twin is `ork tree <run>`.

- **The graph** ([graph](./graph.md)) is what the run recorded in `run.started`,
  so editing the workflow file later does not redraw it, with the workers it has
  spawned added. A run from before edges were kept is drawn from its file
  (`GET /api/runs/:id/graph`).
- **The stat strip** says which run it is, what it has spent against the budget
  it recorded (`run.started`'s `budgetUsd`), as blocks too, how many nodes have
  come to an end, how long it has taken, and how it stands, as a pill. Its
  controls are at the end.
- **Each card** shows its type, id, cost and status, small enough for a long run
  to fit. The rest is in its accessible name, the table and the node's strip.
  The drawing changes only when the run's nodes do, so a busy run does not move
  it, and a view the user has moved stays where it is.
- **The node table** is the graph's twin: an ARIA tree of the same nodes, whose
  rows line up in columns: node, type, status, now, time and cost. It is one tab
  stop. Up and down go through its rows, right opens a node or goes to its first
  child, left closes it or goes to its owner, `Home` and `End` reach its ends,
  and `Enter` selects. A chevron opens and closes a row with a click, and a node
  selected in the graph becomes the row Tab reaches. A narrow panel drops the
  type and time columns.
- **Now** says what a node is doing or last did, in a line: its last tool and
  what that tool is working on, what it asked and was told, its summary when it
  ends, or why it failed. The server folds this from recorded events
  ([activity.ts](../../packages/core/src/store/activity.ts)), showing only the
  fields of a tool's input that name a target, such as a path or a command. A
  wait says its looks, and a queued node says what it's still waiting for, from
  the graph.
- **Pointing at a node** in the graph or the table steps the others back in
  both, except under more contrast.
- **The selected node's strip** sits under the table, with its type, model,
  tokens and controls.
- **Small panels:** the graph keeps a usable height, and the panel scrolls when
  it has less than that, as at 200% zoom (WCAG 1.4.10).
- **A node not done when its run ended** reads skipped if it never started, and
  interrupted if it was running, not queued or running forever.
- **Staying live:** the server folds the run's history into its tree, and the
  panel reads it again when the run's stream has news, at most four times a
  second ([run-watch.ts](../../packages/ui/src/state/run-watch.ts),
  [L63](../gaps/limits.md)). Nothing updates optimistically.
- **Controls:** Pause, Continue and Stop for the run, and for the selected node.
  Each is enabled only where it applies, and stays focusable and says why when
  it is not. Stop asks first. A refused request is a toast.
- **The menu keys** or a right click on a node select it and go to its controls.
  `Escape` goes back to the node, after first closing a tip that is open.
- **Said aloud:** the run going on again, and a node that fails or pauses,
  gathered for a second so a busy run reads as sentences, through the
  workspace's live region. A run ending or pausing and a question opening are
  [notifications](#notifications), so they are not said twice
  ([use-run-announcer.ts](../../packages/ui/src/panels/use-run-announcer.ts)).
  What the run already was when opened is not news (WCAG 4.1.3).
- **Waiting on a source:** a node with a `watch:` says, while its run is going,
  what it's waiting for, how often it looks, how many looks and what the last
  said ([watch-facts.ts](../../packages/ui/src/panels/watch-facts.ts)). Looks
  aren't recorded, so the count and the next look are estimates and say "about"
  ([L118](../gaps/limits-watching.md)). A run that's over shows none of this.
- **Across runs:** a `workflow.call` node opens the run it started, a called run
  links back to its caller, and a run's links are listed with their message
  counts, each opening the run at the other end ([L50](../gaps/limits.md)). The
  focus then lands on the opened run's heading, since the button that had it is
  gone (WCAG 2.4.3).

Selecting a node is shared with the other panels: Logs and Chats follow it.

## Builder

Creates or edits a workflow with no YAML to write
([panel](../../packages/ui/src/builder/builder-panel.tsx),
[tests](../../packages/ui/test/builder/),
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
- **A `watch:`'s `until`** is the same choice as an edge's condition, from what
  the node declares, except that waiting for it to fail isn't offered
  ([until-picker.tsx](../../packages/ui/src/builder/until-picker.tsx)).
- **Edges** are in the inspector: each with its condition and loop limit, added
  from a list or by picking a card, neither of which needs a drag.
- **Every change goes to the server,** which keeps it as a draft in the store
  and answers with the new text and what the checks say. Changes go one at a
  time and read what they build on when their turn comes, and an answer about a
  workflow no longer open changes nothing on screen. Undo steps back through
  this session's changes up to the last save, and Discard asks, then goes back
  to the file. Choosing another project closes what's open.
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
  stop, so the keys can scroll it.
- **Filters** are by node, by event type and by text anywhere in the event. The
  node filter is the shared selection, so choosing a node in the Monitor opens
  it here and the other way round. They look through what is loaded
  ([L65](../gaps/limits.md)). What they leave is said aloud once they stay still
  for half a second (WCAG 4.1.3).
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

- **A card** has where the question comes from, the question, its context and
  its options. The question and context show exactly as written, as a person
  approves that text. The recommended option says so in words, and stands out.
- **An answer** takes one click. With the focus in the card, `1` to `9` choose
  an option, and `Enter` on the card itself takes the recommended one.
- **Nothing is optimistic:** the card stays until the server says it has settled
  on the stream, and a refusal stays in the card in the server's words. If the
  card had the focus, the focus moves to the next one, or to the panel after the
  last.
- **Settled** lists what has left the open list while the page watched, with who
  answered: in the run's terminal, with `ork decide` or in `ork ui`
  (`GET /api/decisions/:id`, [L66](../gaps/limits.md)). Each is also said aloud.

## Chats

One thread per leader or worker of the selected run, built from its events
([panel](../../packages/ui/src/panels/chats-panel.tsx),
[tests](../../packages/ui/test/panels/chats-panel.test.tsx)). Its CLI twin is
`ork chat <run> <node>`.

- **The node** is the shared selection. With none chosen, or one with no
  session, it shows the first that has one.
- **A thread** names who said each thing: the node, you, or a peer writing to
  it, with what the node did between in a quieter line. It is a log, so a screen
  reader hears what is added, and it stays on the newest unless scrolled up,
  also when the panel is shown again.
- **Writing:** `Enter` sends and `Shift+Enter` starts a new line, on a running
  run. The text stays until the server has taken it and a refusal stays beside
  it. The message itself arrives on the stream, saying how it was delivered.
- **Otherwise:** a paused run says to continue it. A run that has ended gives
  the `ork chat` command, ready to copy, since the API does not resume a
  session.
- **While Logs holds still,** the thread reads the feed's tail, the newest 500
  events, so replies keep arriving ([L67](../gaps/limits.md)).

## Notifications

What has happened across runs, newest first, from the overview stream
([panel](../../packages/ui/src/panels/notifications-panel.tsx),
[state](../../packages/ui/src/state/notifications.ts),
[tests](../../packages/ui/test/panels/notifications-panel.test.tsx)). The top
bar's bell shows how many are unread and goes to the panel.

- **Items** are an open decision, and a run that has ended (succeeded, failed,
  out of budget, timed out or interrupted), crashed or paused. A decision's item
  goes when it settles, and a paused run's when it continues
  ([L68](../gaps/limits.md)).
- **Read state** is kept per browser. An item can be marked read singly, or all
  together. In a new browser what had already ended counts as read, so it does
  not start with a pile; what still wants the user stays unread however old it
  is.
- **Opening one** marks it read, selects its run and node, and goes to Decisions
  for a question or the Monitor for a run.
- **New items** are said through the workspace's polite live region. What was
  there when the page opened is not news. When the item holding the focus goes,
  the focus moves to the one now in its place, or to the panel after the last.
- **Desktop notifications** are off until turned on here, which makes the
  browser ask. One is sent only while the page is not being looked at, and a
  refusal is said beside the switch.

## Usage

What runs spent over a period
([panel](../../packages/ui/src/panels/usage-panel.tsx),
[tests](../../packages/ui/test/panels/usage-panel.test.tsx)), from
[`/api/usage`](../usage.md#reports), read again when a run ends. It filters by
project, in name order, and by the last 7, 30 or 90 days or all time, whole days
counting today; the filters survive a change of layout. Two projects of the same
name show their parent folder too.

- **Totals, hints, then spend over time:** one bar per day, or per week past 92
  days, up to today so an idle stretch shows, and hatched since that day or week
  is still going. "Runs with sessions" leaves out runs that only ran tools. The
  line above the chart says what the pointer is on, or the peak; the chart is
  one image to a screen reader. In a short, wide panel the totals sit beside a
  shorter chart, so the default dock shows it. Each column has its date when
  there is room, otherwise the ends do.
- **The table under the chart** lists the days or weeks with spend, newest
  first, and counts the rest.
- **Where it went:** by workflow, model and node, and by project when showing
  all, the costliest 10 of each, one precision per table. What does not fit
  names its `ork usage --by` command. A project shows its path beneath its name.
- **Words:** the empty state gives the next step and its CLI twin, a refusal
  offers **Try again** and `ork usage` above the last good report, if there is
  one, and the foot has the same report's command.
- It says the costs are Claude Code's estimates.

## Context

What the latest chosen node's session loads, layer by layer, as
`ork context explain` prints it
([panel](../../packages/ui/src/panels/context-panel.tsx),
[tests](../../packages/ui/test/panels/context-panel.test.tsx),
[access tests](../../packages/ui/test/panels/context-access.test.tsx)), from the
[node context routes](../server.md#api). It edits nothing.

- **Which node:** the latest chosen anywhere: a run's node from the shared
  selection (the Monitor, Logs, Chats), or the card the person selects in the
  Builder, whose draft it follows, asking again after each edit. A run with no
  node, or none selected in the Builder, says so.
- **The header** names the node (the panel's heading), its type, where it's
  planned from (`review · 4f2a1c`, or `Builder · review · draft`) and the size
  of what Ork appends to its system prompt, with **Reload** and its CLI twin. A
  run's node is planned from the project's files as they are now; a line under
  the header, with its icon beside it, names each file behind it changed since
  the run started ([limits](../gaps/limits-context-inspector.md)). A worker
  spawned in the run is planned as the node it came from, and says so.
- **The stack:** Agent, Project instructions, Skills, Context files, Practices
  and the whole appended system prompt, in the CLI's order, each with its own
  sum (never a total across them, since they don't add up). Each piece is a row
  that opens its words exactly as the session reads them, in monospace, with a
  copy button; it shows whether it's live, its layer, where it comes from and
  its estimated size, and an off piece says why, in the planner's words. A row's
  name is what it shows, in order, with the words only a screen reader needs
  ("layer", "about", "tokens"), so a spoken command can say what's seen.
- **Words:** a node with no session, or a workflow with errors, shows "No
  context to show." and the planner's reason; a failed ask offers **Try again**,
  keeping the answer before it on screen, and the failure is also said through
  the workspace's live region.
- **Focus:** it moves to the node's heading when the shown node changes only if
  the focus was in the panel, and to what the panel says when no node is left;
  it never takes it from the Monitor or the Builder. An opened row sticks to the
  top as its words scroll, and the panel scrolls what takes the focus clear of
  it.
