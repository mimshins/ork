# Runs, Run workflow and the Monitor

_Part of [The panels](./panels.md)._

## Runs

The newest 50 runs from the [overview stream](./state.md#the-containers),
filtered by project ([L37](./limits.md)).

- **A row** has the workflow and its status, as an icon and a word; then the
  run's id, when it started, what it cost, and how many nodes are paused. A
  running run with an open decision reads "waiting on you".
- **Choosing a row** selects the run for the other panels. The selected row has
  an outline as well as its color.
- **Keys:** the list is one tab stop. The arrow keys, Home and End move through
  it, and Enter or Space chooses.
- **The filter** lists the registered projects, and the projects of the runs
  shown, which may be unregistered by now.
- **Rendering:** a row re-renders only when its own run changes
  ([what re-renders](./state.md#what-re-renders)).

The empty state teaches the next step: **Run workflow** or `ork run <workflow>`.

**Triggers,** under the list when any registered project has some, say how each
stands, from [`GET /api/triggers`](../server/api.md): whether it's live and when
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
  dead end. The driver's first choice, "The workflow's, else the one ready",
  passes no `--driver`: the workflow's own driver, else the one ready on the
  machine when the run starts
  ([runtime](../runtime.md#which-driver-a-session-uses)).
- **Use this machine's Claude setup** is a checkbox, off by default, described
  as "Your MCP servers and Claude's memory". Checked, it adds `--machine-claude`
  to the CLI twin and `machineClaude: true` to the request; unchecked, the run's
  sessions start clean ([runtime](../runtime.md#what-a-session-loads)).
- **The CLI twin** is shown as it is filled in, ready to copy. It leaves out
  inputs at their default and quotes what a shell would split.
- **Start run** is disabled until the form can start, and the reason is shown
  beside it and said aloud as it changes. A workflow that does not parse cannot
  start; its error is the reason.
- **After starting,** the dialog selects the new run, closes and shows a toast.
  The run arrives on the stream like any other, about a second later: nothing is
  added to the list in advance. The focus goes to its heading once the Monitor
  shows it, since what opened the dialog may have gone with the run chosen
  before. With no Monitor showing the run, it goes to the run's row in the Runs
  panel if the run has arrived, or else to that panel's **Run workflow**, never
  to the page's body; with no Runs panel either, back where the dialog was
  opened. A refusal stays in the dialog, in the server's words.

Escape on a combobox with its list closed clears it, as the ARIA pattern allows,
so a second Escape closes the dialog. Workspace keys wait while a dialog is open
([workspace](./workspace-keys-palette-and-focus.md#keys)).

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
  come to an end (and, once it ends, what it skipped and which failures an edge
  handled: `5 / 7 · 2 skipped · 1 failure handled`), how long it has taken, and
  how it stands, as a pill. Its controls are at the end.
- **Each card** shows its type, id, cost and status (a node on a driver with no
  prices shows its counted tokens where the cost would be, and a partial total
  reads `≥ $1.20`, [tokens](../usage/tokens.md#partial-totals)), small enough
  for a long run to fit. The rest is in its accessible name, the table and the
  node's strip. The drawing changes only when the run's nodes do, so a busy run
  does not move it, and a view the user has moved stays where it is.
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
  tokens and controls. A node that did not end well adds its end note
  ([design](./design-components-and-copy.md#how-a-node-ended)); a stopped run
  lists such nodes under the stat strip, and a line picks its node.
- **Small panels:** the graph keeps a usable height, and the panel scrolls when
  it has less than that, as at 200% zoom (WCAG 1.4.10).
- **A node not done when its run ended** reads skipped if it never started, and
  interrupted if it was running, not queued or running forever.
- **Staying live:** the server folds the run's history into its tree, and the
  panel reads it again when the run's stream has news, at most four times a
  second ([run-watch.ts](../../packages/ui/src/state/run-watch.ts),
  [L63](./limits.md)). Nothing updates optimistically.
- **Open decisions:** a run with some shows **2 decisions waiting** in its
  header, which goes to Decisions with the run filter set to it
  ([built](./panels-decisions-filters-and-keys.md#monitor-control)).
- **Controls:** Pause, Continue and Stop for the run, and for the selected node.
  Each is enabled only where it applies, and stays focusable and says why when
  it is not. Stop asks first. A refused request is a toast.
- **Resume…**
  ([run-controls.tsx](../../packages/ui/src/panels/run-controls.tsx),
  [tests](../../packages/ui/test/panels/monitor-resume.test.tsx)) joins the
  run's controls once it ended without succeeding (failed, interrupted, crashed,
  or out of budget, quota or time), and is disabled, saying why, on a run of one
  node, as `ork resume` refuses those. It asks first, saying it's a paid run and
  what runs again, with `ork resume <run> --detach` as a code block, then sends
  `POST /api/runs/:id/resume` with no flags, so the run keeps the inputs and
  flags it started with. A refusal, in the CLI's words, stays in the dialog. The
  run going live takes the button away, so the focus goes to the run's heading.
- **A note** ([note dialog](../../packages/ui/src/panels/note-dialog.tsx),
  [tests](../../packages/ui/test/panels/note-dialog.test.tsx)): **Note…** after
  the node's controls, and a note icon among the run's, which takes one after it
  ended too. A node that never ran (queued or skipped) has it disabled, and says
  so. The dialog has the note (its first line is the title), and a rating, kind
  and severity chosen from `ork feedback note`'s lists; a bad rating raises the
  severity to high until one is chosen, and says so in a line the Severity field
  is described by. Its CLI twin leaves out the defaults. A refusal stays in the
  dialog; once noted, a toast names the item it joined
  (`POST /api/runs/:id/notes`).
- **The menu keys** or a right click on a node select it and go to its controls.
  `Escape` goes back to the node, after first closing a tip that is open.
- **Said aloud:** the run going on again, and a node that fails or pauses,
  gathered for a second so a busy run reads as sentences, through the
  workspace's live region. A run ending or pausing and a question opening are
  [notifications](./panels-chats-notifications-and-usage.md#notifications), so
  they are not said twice
  ([use-run-announcer.ts](../../packages/ui/src/panels/use-run-announcer.ts)).
  What the run already was when opened is not news (WCAG 4.1.3).
- **Waiting on a source:** a node with a `watch:` says, while its run is going,
  what it's waiting for, how often it looks, how many looks and what the last
  said ([watch-facts.ts](../../packages/ui/src/panels/watch-facts.ts)). Looks
  aren't recorded, so the count and the next look are estimates and say "about"
  ([L118](../scheduler/watching-limits.md)). A run that's over shows none of
  this.
- **Across runs:** a `workflow.call` node opens the run it started, a called run
  links back to its caller, and a run's links are listed with their message
  counts, each opening the run at the other end ([L50](../messaging/limits.md)).
  The focus then lands on the opened run's heading, since the button that had it
  is gone (WCAG 2.4.3).

Selecting a node is shared with the other panels: Logs and Chats follow it.

### Items of a fanned node

Status: **built** for [for-each](../scheduler/for-each.md)
([monitor-model.ts](../../packages/ui/src/panels/monitor-model.ts),
[node-table.ts](../../packages/ui/src/panels/node-table.ts)).

A node with `forEach` is one card ([graph](./graph.md#a-node-with-foreach)) and
a row with its items under it, as a leader has its workers. The server nests
them, in list order, under their node (`build.0`, `build.1`, …), so the table
only walks the tree.

- **Item rows** are the same columns as any node: id (`build.2`), the node's
  type, status as a glyph and a word, now, time and cost. They open and close
  with the node's chevron, start open, and take the tree's keys unchanged: right
  on `build` goes to `build.0`, left on an item goes back to `build`, and a
  selected item under a closed node leaves `build` as the row Tab reaches. Down
  and `End` pass over the items of an open node like any child.
- **The fanned node's row** has its own status glyph and word (`running`), and
  its _now_ cell is the progress, `3 of 8, 1 failed`, followed by `· <reason>`
  when the node failed with one. Before `each.listed` it reads as any node's.
- **Failed items** show the failed glyph and the word `failed` in their row and
  name, so color is never the only signal.
- **Selecting an item** is the shared selection: Logs filters to it, and Chats
  and Usage follow as for any node, and the graph
  [holds its node's card](./graph.md#a-node-with-foreach).
- **The item's strip** replaces the node's strip, with the item's type, model,
  tokens and controls as for any node, and one line saying what it is: "Item of
  `build`, index 2". Pause, Continue and Stop and **Note…** act on the item. Its
  row's accessible description gives `ork logs <run> --node build.2`, and its
  strip has a _Logs_ line with the same command. The fanned node's strip adds
  _Items_: `3 of 8, 1 failed`.
- **Said aloud:** an item that fails is a node that fails: "build.2 failed."
  Items finishing well are not news.
- **Empty and old runs:** a node that listed nothing has no chevron and reads
  `0 of 0`. The server moves items that arrive as roots or under a leader under
  their node; an item of an unknown node stays put.
