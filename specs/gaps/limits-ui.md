# Limits: the browser view

_Part of [Known gaps and limits](../gaps.md)._

How the [browser view](../ui.md) and its [server](../server.md) work for now, by
choice.

- **L25 · The server starts runs only in registered projects.** A run of an
  unregistered in-repo project shows in the API, but `POST /api/runs` needs the
  project registered (`ork init`, `ork register`). ([server](../server/api.md))
- **L26 · The UI cannot talk to a finished run's node yet.** The API messages a
  live run only, and answers 409 naming `ork chat` for a finished one, which
  resumes the node's session in a process of its own.
  ([server](../server/api.md))
- **L27 · The overview stream polls.** It compares the newest 50 runs and the
  open decisions every second; only a run's own stream is pushed, over its
  socket. ([server](../server/streams-contract-and-security.md#streams))
- **L32 · The UI shows dark for a moment before light.** The page's policy
  allows no inline script, so the look is set when the app's module runs; until
  then a light system sees the dark theme. A theme cookie the server reads could
  set `data-theme` in the page itself.
  ([design system](../ui/design-tokens-and-type.md#themes))
- **L33 · Group sizes can shift after several minimizes.** Each panel returns to
  the right place, and one minimize and restore is exact; restoring several out
  of order can change other groups' sizes. Saving the whole dock's description
  at each minimize could restore them exactly.
  ([workspace](../ui/workspace-layout-and-narrow-window.md#limits))
- **L34 · Keyboard moves are coarser than the mouse.** A key moves a panel into
  its neighbor or to the workspace's edge; dropping it beside one particular
  group takes the mouse.
  ([workspace](../ui/workspace-layout-and-narrow-window.md#limits))
- **L35 · dockview's other skins ship unused.** Its one style sheet holds all
  its themes, inert without their class; the file is 160 kB, or 13 kB gzipped. A
  build step could strip them.
  ([workspace](../ui/workspace-layout-and-narrow-window.md#limits))
- **L36 · A browser limits the streams of all a server's tabs together.** The
  server speaks HTTP/1.1, where a browser gives an origin six connections. Each
  tab holds the overview stream and one per run on show, so about three tabs
  with a run open use them all, and the next tab's requests wait. HTTP/2 needs
  TLS in a browser; a `SharedWorker` or `BroadcastChannel` could share one
  stream between tabs. ([state](../ui/state.md#a-runs-feed))
- **L37 · The Runs panel sees the newest 50 runs.** The overview stream sends
  that many, and the filter narrows them in the page, so an older run, or a
  quiet project behind busy ones, needs `ork ps`. The panel says so when a
  filter finds none. The stream's `?project=` and paging on `/api/runs` could
  reach them. ([panels](../ui/panels-runs-and-monitor.md#runs))
- **L63 · A run's tree is read again, not folded in the browser.** The Monitor
  asks the server for it at most four times a second while the run is busy. That
  is the whole history each time, so a very long run costs more to watch.
  ([panels](../ui/panels-runs-and-monitor.md#monitor))
- **L64 · A graph card's keys are heard, not shown.** Zoom, fit and pan show
  their keys in their tooltips, but `Enter`, `Shift+F10` and `Escape` on a card
  are only in the canvas's description, which sighted keyboard users never see.
  Cards at low zoom are also smaller than 24 px, which WCAG 2.5.8 allows because
  the ownership tree's rows do the same at full size.
  ([graph](../ui/graph.md#keys-and-names))
- **L65 · Logs filters only what is loaded.** The page holds the newest 2000
  events of a run, and its filters look through those. An older match needs
  **Load older** first, and the panel says so when nothing matches. The server
  has no filtered read.
  ([panels](../ui/panels-builder-logs-and-decisions.md#logs))
- **L66 · The Decisions panel's Settled list lasts as long as the page.** It
  holds what left the open list while the page watched, the newest 20, so a
  reload empties it and a decision answered while no page was open never
  appears. The run's log still has them.
  ([panels](../ui/panels-builder-logs-and-decisions.md#decisions))
- **L67 · A thread shows what is loaded.** Chats reads the run's window of
  events, the newest 2000, or the newest 500 while Logs holds it still. On a
  long run the start of a conversation can be out of reach; `ork logs --node`
  has it all. The server has no read of one node's events.
  ([panels](../ui/panels-chats-notifications-and-usage.md#chats))
- **L68 · Notifications are as long as the overview's list.** Items come from
  the runs and open decisions the overview stream sends, so a run that falls out
  of its newest 20 leaves the list, and a run paused again after being read does
  not notify twice. There is no stored history of notifications.
  ([panels](../ui/panels-chats-notifications-and-usage.md#notifications))
- **L69 · Starting a run with no Monitor showing leaves the focus to Base UI.**
  With the Monitor closed or behind another tab and the dialog's origin gone
  with the run chosen before, the focus goes where Base UI puts it, as low as
  the page's body. The Runs panel's new row could take it instead, once it
  arrives. ([panels](../ui/panels-runs-and-monitor.md#run-workflow))
- **L70 · The UI has not met a real screen reader or touch screen.** Names,
  roles and live regions are checked in the browser's accessibility tree, with
  axe, and by watching the region's text; touch and pinch are tested as events;
  forced colors only under Chrome's emulation; a desktop notification firing and
  being clicked has not been seen. ([panels](../ui/panels.md))
- **L71 · The UI has no Resume button.** The server's API can resume a run, but
  no panel offers it: a stopped or crashed run is resumed with `ork resume`; the
  Stop dialog says it can be, from a terminal.
  ([guide](../../docs/guides/browser-view/keys-and-accessibility.md#what-it-does-not-do-yet))
- **L165 · The inline-command check reads only literal words.** It fails on a
  backticked command in the UI's strings and templates and on one opening a
  `<code>` element, but a run whose command is all interpolated
  (`` `${command}` ``), or a `<code>{cli}</code>`, passes; review catches those.
  ([design system](../ui/design-components-and-copy.md#copy))
