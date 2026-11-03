# The panels

_Part of [The UI](../ui.md)._

Status: **In progress.** Built: the Runs panel, the Run workflow dialog, the
Monitor, Logs and Decisions ([panels](../../packages/ui/src/panels/),
[tests](../../packages/ui/test/panels/)). Chats and Notifications are planned,
and each names the `ork` command to use until then.

## Contents

- [Runs](#runs)
- [Run workflow](#run-workflow)
- [Monitor](#monitor)
- [Logs](#logs)
- [Decisions](#decisions)

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
  added to the list in advance. A refusal stays in the dialog, in the server's
  words.

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
  spawned added and cards where the file's `.layout.json` puts them now. A run
  from before edges were kept is drawn from its file
  (`GET /api/runs/:id/graph`).
- **Each card** shows its status, model, tokens and cost. The drawing changes
  only when the run's nodes do, so a busy run does not move it, and a view the
  user has moved stays where it is.
- **The ownership tree** is the graph's twin: an ARIA tree of the same nodes,
  one tab stop. Up and down go through its rows, right opens a node or goes to
  its first child, left closes it or goes to its owner, `Home` and `End` reach
  its ends, and `Enter` selects. A chevron opens and closes a row with a click,
  and a node selected in the graph becomes the row Tab reaches. It stacks under
  the graph when the panel is narrow.
- **Small panels:** the graph keeps a usable height, and the panel scrolls when
  it has less than that, as at 200% zoom (WCAG 1.4.10).
- **Staying live:** the server folds the run's history into its tree, and the
  panel reads it again when the run's stream has news, at most four times a
  second ([run-watch.ts](../../packages/ui/src/state/run-watch.ts),
  [L63](../gaps/limits.md)). Nothing updates optimistically.
- **Controls:** Pause, Continue and Stop for the run, and for the selected node.
  Each is enabled only where it applies, and stays focusable and says why when
  it is not. Stop asks first. A refused request is a toast.
- **The menu keys** or a right click on a node select it and go to its controls.
  `Escape` goes back to the node, after first closing a tip that is open.
- **Said aloud:** the run's status when it changes, and a node that fails,
  pauses or waits on you, gathered for a second so a busy run reads as
  sentences, through the workspace's live region
  ([use-run-announcer.ts](../../packages/ui/src/panels/use-run-announcer.ts)).
  What the run already was when opened is not news (WCAG 4.1.3).
- **Across runs:** a `workflow.call` node opens the run it started, a called run
  links back to its caller, and a run's links are listed with their message
  counts, each opening the run at the other end ([L50](../gaps/limits.md)). The
  focus then lands on the opened run's heading, since the button that had it is
  gone (WCAG 2.4.3).

Selecting a node is shared with the other panels: Logs follows it, and Chats
will when it is built.

## Logs

The selected run's events, live
([panel](../../packages/ui/src/panels/logs-panel.tsx),
[tests](../../packages/ui/test/panels/logs-panel.test.tsx)). Its CLI twin is
`ork logs <run> --follow`, shown on the Follow button.

- **A row** has the event's time, node, type and a line in words. Opening it
  shows the whole event. The list is one tab stop: the arrow keys, `Home` and
  `End` move through it, and `Enter` opens a row.
- **Filters** are by node, by event type and by text anywhere in the event. The
  node filter is the shared selection, so choosing a node in the Monitor opens
  it here and the other way round. They look through what is loaded
  ([L65](../gaps/limits.md)).
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
  its options. The recommended option says so in words, and stands out.
- **An answer** takes one click. With the focus in the card, `1` to `9` choose
  an option, and `Enter` on the card itself takes the recommended one.
- **Nothing is optimistic:** the card stays until the server says it has settled
  on the stream, and a refusal stays in the card in the server's words. If the
  card had the focus, the focus moves to the next one.
- **Settled** lists what has left the open list while the page watched, with who
  answered: in the run's terminal, with `ork decide` or in `ork ui`
  (`GET /api/decisions/:id`, [L66](../gaps/limits.md)). Each is also said aloud.
