# Chats, Notifications and Usage

_Part of [The panels](./panels.md)._

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
  events, so replies keep arriving ([L67](../gaps/limits-ui.md)).

## Notifications

What has happened across runs, newest first, from the overview stream
([panel](../../packages/ui/src/panels/notifications-panel.tsx),
[state](../../packages/ui/src/state/notifications.ts),
[tests](../../packages/ui/test/panels/notifications-panel.test.tsx)). The top
bar's bell shows how many are unread and goes to the panel.

- **Items** are an open decision, and a run that has ended (succeeded, failed,
  out of budget, timed out or interrupted), crashed or paused. A decision's item
  goes when it settles, and a paused run's when it continues
  ([L68](../gaps/limits-ui.md)).
- **Read state** is kept per browser. An unread item is tinted, with a heavier
  title and the word "unread". An item can be marked read singly, or all
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
