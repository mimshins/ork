# The panels

_Part of [The UI](../ui.md)._

Status: **Built:** the Runs panel, the Run workflow dialog, the Monitor, Logs,
Decisions, Chats, Notifications and Usage
([panels](../../packages/ui/src/panels/),
[tests](../../packages/ui/test/panels/)). The designer and context inspector are
the next milestone.

## Contents

- [Runs](#runs)
- [Run workflow](#run-workflow)
- [Monitor](#monitor)
- [Logs](#logs)
- [Decisions](#decisions)
- [Chats](#chats)
- [Notifications](#notifications)
- [Usage](#usage)

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
- **Across runs:** a `workflow.call` node opens the run it started, a called run
  links back to its caller, and a run's links are listed with their message
  counts, each opening the run at the other end ([L50](../gaps/limits.md)). The
  focus then lands on the opened run's heading, since the button that had it is
  gone (WCAG 2.4.3).

Selecting a node is shared with the other panels: Logs and Chats follow it.

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
  its options. The recommended option says so in words, and stands out.
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
project, and by the last 7, 30 or 90 days or all time. Two projects of the same
name show their parent folder too.

- **Totals, hints, then spend over time:** one bar per day, or per week past 92
  days, up to today so an idle stretch shows. The line above the chart says what
  the pointer is on; the chart is one image to a screen reader, with a table of
  the same numbers below it.
- **Where it went:** by workflow, model and node, and by project when showing
  all, the costliest 10 of each.
- It says the costs are Claude Code's estimates.
