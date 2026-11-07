# Runs, Run workflow and the Monitor

_Part of [The panels](./panels.md)._

## Runs

The newest 50 runs from the [overview stream](./state.md#the-containers),
filtered by project ([L37](../gaps/limits-ui.md)).

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
  before ([L69](../gaps/limits-ui.md)). A refusal stays in the dialog, in the
  server's words.

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
  [L63](../gaps/limits-ui.md)). Nothing updates optimistically.
- **Controls:** Pause, Continue and Stop for the run, and for the selected node.
  Each is enabled only where it applies, and stays focusable and says why when
  it is not. Stop asks first. A refused request is a toast.
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
  ([L118](../gaps/limits-watching.md)). A run that's over shows none of this.
- **Across runs:** a `workflow.call` node opens the run it started, a called run
  links back to its caller, and a run's links are listed with their message
  counts, each opening the run at the other end ([L50](../gaps/limits.md)). The
  focus then lands on the opened run's heading, since the button that had it is
  gone (WCAG 2.4.3).

Selecting a node is shared with the other panels: Logs and Chats follow it.
