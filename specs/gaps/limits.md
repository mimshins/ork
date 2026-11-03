# Limits

_Part of [Known gaps and limits](../gaps.md)._

How something built works for now, by choice.

- **L2 · A resumed run's budget counts what it spent.** Raise `limits.budgetUsd`
  to resume a run that ran out.
  ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L3 · Resume keeps finished results as they were.** The workflow file is read
  again, but a finished node keeps its result even if its definition changed,
  and new worktrees branch from the project's current `HEAD`.
  ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L4 · A run of one node is not resumed.** `ork run --node` runs again
  instead. ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L6 · `delegate` blocks the leader.** There is no asynchronous form, and on
  the CLI driver one call can stay open for at most 24 hours.
  ([ADR-017](../../decisions/ADR-017-blocking-delegate.md))
- **L7 · A shadowed project skill hides its alias.** Switching off a project
  skill named `review` also hides Claude Code's `/code-review`.
  ([ADR-023](../../decisions/ADR-023-context-compiler.md))
- **L8 · Integrations ship with Ork.** A new CLI integration needs an Ork
  release; there are no declared or third-party integrations.
  ([ADR-022](../../decisions/ADR-022-integration-registry.md))
- **L9 · Windows only through WSL.** Native Windows is untested.
  ([installation](../../docs/getting-started/installation.md))
- **L10 · Claims are advisory.** They steer agents but lock nothing: a node that
  edits without claiming is not stopped.
  ([ADR-027](../../decisions/ADR-027-advisory-claims.md))
- **L13 · Tool folders are linked with symlinks.** On native Windows, git checks
  links out as plain files unless `core.symlinks` is on (developer mode); there
  is no junction or copy fallback.
  ([ADR-031](../../decisions/ADR-031-ork-is-the-origin.md))
- **L14 · Project permissions are `allow` and `deny` only.** Claude Code's `ask`
  list (prompt before a tool) is left to the project's own
  `.claude/settings.json`, which a node loads.
  ([project rules](../project-rules.md))
- **L15 · A patch applies whole or not at all.** Under `merge: patch`, a child
  whose changes do not apply cleanly is kept with the conflicting files named;
  there is no three-way apply with conflict markers.
  ([ADR-032](../../decisions/ADR-032-project-rules.md))
- **L16 · `git.base` is not fetched.** A base such as `origin/main` is whatever
  the clone last fetched; Ork never fetches.
  ([project rules](../project-rules.md))
- **L17 · A `tool.git` commit under `commit: never` is on no branch.** The
  worktree is detached, so the workflow makes its own branch (`switch -c`,
  allowed on the node) or the commit stays on none; `ork worktrees clean` keeps
  such a worktree unless `--force`. Ork could make the root's branch from
  `git.branch` without committing.
  ([ADR-034](../../decisions/ADR-034-tool-git.md))
- **L18 · An allow list checks the subcommand, not its flags.**
  `allow: [commit]` also allows `commit --amend` or `commit --no-verify`; what
  follows the prefix is the workflow's.
  ([workflow format](../workflow-format.md))

- **L19 · An attached project's own folder holds only agents and lessons.** A
  skill or context file kept in `~/.ork/projects/<id>/` cannot be referenced: an
  attached workflow's paths resolve inside the repository.
  ([projects](../projects.md))
- **L22 · A migration is not atomic.** Its plan is checked before anything
  moves, but a move that fails halfway (a permission, a full disk) stops there;
  nothing is lost, and `ork migrate` again plans what is left.
  ([projects](../projects.md#migrating))
- **L23 · The update check reads no `.npmrc`.** It asks npm's registry, or
  `ORK_UPDATE_REGISTRY`; a mirror set only in npm's own config is not used.
  ([updates](../cli/updates.md))
- **L24 · `ork upgrade` knows an install by its path.** An install in a place it
  does not recognise gets the npm command as advice, and nothing is run.
  ([updates](../cli/updates.md#ork-upgrade))
- **L25 · The server starts runs only in registered projects.** A run of an
  unregistered in-repo project shows in the API, but `POST /api/runs` needs the
  project registered (`ork init`, `ork register`). ([server](../server.md#api))
- **L26 · The UI cannot talk to a finished run's node yet.** The API messages a
  live run only, and answers 409 naming `ork chat` for a finished one, which
  resumes the node's session in a process of its own.
  ([server](../server.md#api))
- **L27 · The overview stream polls.** It compares the newest 50 runs and the
  open decisions every second; only a run's own stream is pushed, over its
  socket. ([server](../server.md#streams))
- **L28 · One local user.** The server binds loopback only, with one token per
  start; there is no remote access, TLS, or second user, and anything that can
  read `~/.ork/ui.json` as the user can drive it, as it can drive `ork`.
  ([ADR-039](../../decisions/ADR-039-local-server.md))
- **L29 · Managed settings can turn off the CLI driver's pause.** A pause holds
  a `claude -p` session in a `PreToolUse` HTTP hook; where managed settings
  allow only managed hooks or other hook URLs, the hook never fires, and a
  CLI-driven node pauses only at its next activation.
  ([run control](../run-control.md#limits))
- **L30 · A single-node run takes only `stop`.** `ork run <wf> --node <id>` is
  not paused or continued, and has no node of its own to stop.
  ([run control](../run-control.md#limits))
- **L31 · Stopping a leader leaves its running children running.** Its delegated
  children follow the owner-failure path and finish their work; only the leader
  is interrupted. ([run control](../run-control.md#stopping-one-node))
- **L32 · The UI shows dark for a moment before light.** The page's policy
  allows no inline script, so the look is set when the app's module runs; until
  then a light system sees the dark theme. A theme cookie the server reads could
  set `data-theme` in the page itself.
  ([design system](../ui/design-system.md#themes))
- **L33 · Group sizes can shift after several minimizes.** Each panel returns to
  the right place, and one minimize and restore is exact; restoring several out
  of order can change other groups' sizes. Saving the whole dock's description
  at each minimize could restore them exactly.
  ([workspace](../ui/workspace.md#limits))
- **L34 · Keyboard moves are coarser than the mouse.** A key moves a panel into
  its neighbor or to the workspace's edge; dropping it beside one particular
  group takes the mouse. ([workspace](../ui/workspace.md#limits))
- **L35 · dockview's other skins ship unused.** Its one style sheet holds all
  its themes, inert without their class; the file is 160 kB, or 13 kB gzipped. A
  build step could strip them. ([workspace](../ui/workspace.md#limits))
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
  reach them. ([panels](../ui/panels.md#runs))
- **L38 · A long home path has no sockets.** A Unix socket's path is limited
  (104 characters on macOS). Past that a run cannot listen, and Ork says
  nothing: it looks at the store every second instead, so answers and commands
  take up to a second, and followers poll the store too.
  ([messaging](../messaging.md#reaching-a-live-run))
- **L39 · Limits are per run.** `limits.concurrency` and `limits.budgetUsd` do
  not add up across runs, so three runs at the default can hold 12 Claude
  sessions. ([scheduler](../scheduler.md#budget-and-concurrency))
- **L40 · Claims are per run.** Two runs in one repository work in separate
  worktrees but do not see each other's claims.
  ([messaging](../messaging.md#claims))

- **L41 · A retry has no delay.** A failed node can loop back with `maxRounds`,
  but it runs again at once, with no delay or backoff.
  ([scheduler](../scheduler.md#loops))
- **L42 · A handled failure reads as success.** A failed node with an edge
  taken, such as a cleanup on `when: "true"`, leaves the run `succeeded`; only
  the node's own status shows it. ([scheduler](../scheduler.md#edges))
- **L43 · Nothing limits runs of one workflow.** Starting a workflow twice runs
  it twice, with no queueing and no cancelling of the older run, as other
  engines' concurrency groups do.
  ([scheduler](../scheduler.md#budget-and-concurrency))
- **L44 · Results are reused only within a resumed run.** No step cache spans
  runs. An agent's output varies, so one may never be worth having.
  ([resuming](../scheduler/resuming-and-events.md#resuming-a-run))

- **L45 · A resumed run's clocks start again.** Time already worked is not
  counted, so a resumed run gets its whole `limits.timeout` again.
  ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L46 · A node left behind may still spend.** An executor that has not ended
  10 seconds after a timeout is abandoned, and a session's cost from then on is
  unknown to the run. ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L47 · A tool can outlive Ork.** Tools run in their own process groups, so a
  second Ctrl-C within 2 seconds, or Ork being killed, leaves one running. A
  program that starts its own session escapes a stop altogether.
  ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L48 · A link does not survive a resume.** A link ends with its run, so a
  resumed run has none until the user links it again. Its unread messages are
  kept. ([messaging](../messaging/links.md))
- **L49 · A link names one node.** It joins the exact node given, so a spawned
  worker needs its own (`tests-2`), and a run of one node (`ork run --node`)
  cannot be linked. ([messaging](../messaging/links.md))
- **L50 · The UI does not show links yet.** The API has them, but the overview
  stream does not carry them; the Monitor brings them in.
  ([messaging](../messaging/links.md))
- **L51 · A link's limit of 100 is a guess.** Nothing has measured how many
  messages real work takes. ([messaging](../messaging/links.md))
- **L52 · A link ending can cost a session a turn.** Each peer is told, and a
  session that is writing its report then takes one more turn to acknowledge it.
  Seen on a real run. Telling only a session that is waiting would avoid it.
  ([messaging](../messaging/links.md))
- **L53 · A shared budget is settled late.** A called run is capped to what its
  caller had left when it started, and its cost counts against the caller only
  when the call finishes. Calls running together can overspend the caller's cap
  by up to one cap each. A `wait: none` call's cost is never counted, nor is
  what a run spends between the caller's stop and its own end. A run brought
  back by a resume keeps its old cap, so raising the caller's budget does not
  rescue one that ran out; resume it with its own higher `limits.budgetUsd`.
  ([calls](../scheduler/calls.md))
- **L54 · Totals count a called run twice.** `ork ps` shows a called run's cost
  on it and again on its caller, so adding up the list overstates what was
  spent. The Monitor should show a tree's total.
  ([calls](../scheduler/calls.md))
- **L55 · A caller's clock runs while a called run waits on the user.** A node's
  clock pauses for its own question, but a call's and its run's `timeout` do not
  see a question in the called run. ([calls](../scheduler/calls.md))
- **L56 · Pause does not reach called runs.** A paused caller's called runs go
  on, by choice for now. ([calls](../scheduler/calls.md))
- **L57 · A message to a call that never starts is lost.** Its sender was told
  `queued`, and hears nothing if the call fails first. After a caller's resume,
  a call that is not activated again has no link, so messages to it are refused
  until it is. ([links](../messaging/links.md#calls))
- **L58 · An activation cut off by a stop can tell its input twice.** A resumed
  caller gives a live called session the input again, in case it did not arrive.
  ([calls](../scheduler/calls.md))
- **L59 · A called run's questions have no terminal.** They wait in `ork decide`
  or the UI's inbox even when the caller runs in a terminal, because the called
  run is a background process. ([calls](../scheduler/calls.md))
- **L60 · A later activation that resumes a session waits for it.** Whatever its
  `wait`, a call whose node has reported blocks until the resumed session ends,
  since it runs in the caller's process. Its log shows the input as `you:`,
  though the message itself says it is from the workflow.
  ([calls](../scheduler/calls.md))
- **L61 · Parallel activations come back by position.** A resume hands a node's
  kept results and open runs back in order, as it always has for any node, so
  with parallel activations a result or a run can return to a different
  activation than made it, with other inputs. ([calls](../scheduler/calls.md))
- **L62 · Edges between hand-placed nodes can cross a card.** With a
  `.layout.json`, an edge curves straight between its two nodes and does not
  look for a way around what the user put between them.
  ([graph](../ui/graph.md))
