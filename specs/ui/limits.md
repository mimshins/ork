# Limits: the browser view

_Part of [The UI](../ui.md)._

How the [browser view](../ui.md) and its [server](../server.md) work for now, by
choice. Those the gaps review carried are open work in the
[register](../gaps.md#limits).

- **C6 · The UI has no browser tests in CI.** That is the policy: its components
  are tested in jsdom with axe, and each UI feature gets a real-browser audit
  when it is built (keyboard, focus, sizes, drawn positions, contrast and zoom),
  which jsdom cannot check ([workspace](./workspace.md)). Playwright is not in
  CI. ([ADR-040](../../decisions/ADR-040-ui-stack.md))
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
- **L28 · One local user.** The server binds loopback only, with a token (a
  bearer) and a session secret (the cookie) per start; there is no remote
  access, TLS, or second user, every browser of one `ork ui` shares the session
  secret, and anything that can read `~/.ork/ui.json` as the user can drive it,
  as it can drive `ork`. ([ADR-039](../../decisions/ADR-039-local-server.md),
  [ADR-090](../../decisions/ADR-090-ork-ui-signs-in-with-a-code.md),
  [G32](../gaps.md))
- **L32 · A theme chosen against the system shows the system's for a moment.**
  The page's policy allows no inline script, so a chosen theme is set when the
  app's module runs; until then the page follows the system, so dark chosen on a
  light system, or light on a dark one, shows the system's theme first. A theme
  cookie the server reads could set `data-theme` in the page itself.
  ([design system](./design-tokens-and-type.md#themes))
- **L33 · Group sizes can shift after several minimizes.** Each panel returns to
  the right place, and one minimize and restore is exact; restoring several out
  of order can change other groups' sizes. Saving the whole dock's description
  at each minimize could restore them exactly.
  ([workspace](./workspace-layout-and-narrow-window.md#limits))
- **L34 · Keyboard moves are coarser than the mouse.** A key moves a panel into
  its neighbor or to the workspace's edge; dropping it beside one particular
  group takes the mouse.
  ([workspace](./workspace-layout-and-narrow-window.md#limits))
- **L35 · dockview's other skins ship unused.** Its one style sheet holds all
  its themes, inert without their class; the file is 160 kB, or 13 kB gzipped. A
  build step could strip them.
  ([workspace](./workspace-layout-and-narrow-window.md#limits))
- **L36 · A browser limits the streams of all a server's tabs together.** The
  server speaks HTTP/1.1, where a browser gives an origin six connections. Each
  tab holds the overview stream and one per run on show, so about three tabs
  with a run open use them all, and the next tab's requests wait. HTTP/2 needs
  TLS in a browser; a `SharedWorker` or `BroadcastChannel` could share one
  stream between tabs. ([state](./state.md#a-runs-feed))
- **L37 · The Runs panel sees the newest 50 runs, or 20 under a filter.** With
  no filter the overview stream's 50 show; with one the panel reads
  `GET /api/runs` for it, which answers its 20 newest matches, so an older run
  needs `ork ps` with a larger `--limit`. Paging on `/api/runs` and a `limit` in
  the panel could reach them. ([panels](./panels-runs-and-monitor.md#runs))
- **L63 · A run's tree is read again, not folded in the browser.** The Monitor
  asks the server for it at most four times a second while the run is busy. That
  is the whole history each time, so a very long run costs more to watch.
  ([panels](./panels-runs-and-monitor.md#monitor))
- **L64 · A graph card at low zoom is smaller than 24 px.** WCAG 2.5.8 allows
  it, because the ownership tree's rows do the same at full size.
  ([graph](./graph.md#keys-and-names))
- **L65 · Logs filters only what is loaded.** The page holds the newest 2000
  events of a run, and its filters look through those. An older match needs
  **Load older** first, and the panel says so when nothing matches. The server
  has no filtered read. ([panels](./panels-builder-logs-and-decisions.md#logs))
- **L66 · The Decisions panel's Settled list lasts as long as the page.** It
  holds what left the open list while the page watched, the newest 20, so a
  reload empties it and a decision answered while no page was open never
  appears. The run's log still has them.
  ([panels](./panels-builder-logs-and-decisions.md#decisions))
- **L67 · A thread shows what is loaded.** Chats reads the run's window of
  events, the newest 2000, or the newest 500 while Logs holds it still. On a
  long run the start of a conversation can be out of reach; `ork logs --node`
  has it all. The server has no read of one node's events.
  ([panels](./panels-chats-notifications-and-usage.md#chats))
- **L68 · Notifications are as long as the overview's list.** Items come from
  the runs and open decisions the overview stream sends, so a run that falls out
  of its newest 20 leaves the list, and a run paused again after being read does
  not notify twice. There is no stored history of notifications.
  ([panels](./panels-chats-notifications-and-usage.md#notifications))
- **L70 · The UI has not met a real screen reader or touch screen.** Names,
  roles and live regions are checked in the browser's accessibility tree, with
  axe, and by watching the region's text; touch and pinch are tested as events;
  forced colors only under Chrome's emulation; a desktop notification firing and
  being clicked has not been seen. ([panels](./panels.md))
- **L165 · The inline-command check reads only literal words.** It fails on a
  backticked command in the UI's strings and templates and on one opening a
  `<code>` element, but a run whose command is all interpolated
  (`` `${command}` ``), or a `<code>{cli}</code>`, passes; review catches those.
  ([design system](./design-components-and-copy.md#copy))
