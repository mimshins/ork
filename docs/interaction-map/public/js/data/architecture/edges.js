/**
 * @file The architecture map's connections. Lanes in use: `x` 290 between you
 *   and the surfaces; `x` 548, 554, 562, 570, 572 and 580 between the surfaces
 *   and the engine; `x` 826, 834, 840, 848, 850, 856 and 862 between the
 *   engine's two columns; `x` 1112 down the engine's right, from the bus to the
 *   links; `x` 1130 between the engine and your machine; `y` 456 above the
 *   message bus; `x` 1410 and 1690 in the runtime. The rows at y 360, 480 and
 *   600 of "Your machine" stay empty so the engine and the runtime can reach
 *   each other straight across. The row at y 1320 is `ork watch`, from outside
 *   any run.
 */

import {
  CALLS,
  CLI,
  CONTEXT,
  CORE,
  DESIGN,
  LINKS,
  README,
  SCHEMA,
  SERVER,
  STORE,
  UI,
  WATCH,
  WORKTREES,
} from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "user-cli",
    from: "user",
    to: "cli",
    kind: "human",
    label: "runs `ork …`",
    detail: "You validate, run, watch and answer from the terminal.",
    docs: [DESIGN.cli],
  },
  {
    id: "user-ui",
    from: "user",
    to: "ui",
    kind: "human",
    label: "designs · watches · answers",
    detail:
      "You watch and control a run live, chat with its nodes and answer decisions in the browser, build a workflow there with no YAML to write, tidy what runs left in their worktrees, and upgrade Ork.",
    status: "built",
    docs: [DESIGN.ui, UI.guide],
  },
  {
    id: "ui-server",
    from: "ui",
    to: "server",
    kind: "net",
    label: "JSON + SSE",
    detail:
      "The UI calls the API through the typed client, signed in with the session cookie. Its panels follow the overview and each run over the event streams, and a write comes back on a stream; nothing updates in advance. The overview stream also carries what the server knows of new versions, and the Upgrade dialog follows the package manager's output on a stream of its own.",
    status: "built",
    docs: [DESIGN.server, SERVER.contract, SERVER.updateRoutes],
  },
  {
    id: "cli-server",
    from: "cli",
    to: "server",
    kind: "net",
    label: "`ork ui` runs it as a child",
    detail:
      "`ork ui` starts the server as a child (`ork ui --serve`), hands it the port, the token and a session secret over IPC, gets a one-time code with the token, and opens `/?code=…` (the token is never in the link), or opens the one `~/.ork/ui.json` names. On the page's Restart it starts the launcher again on the same port with the same token and session secret, so an upgraded install serves the same tab (ADR-060). Every other command works without it: both read and write the same store.",
    status: "built",
    docs: [
      SERVER.command,
      SERVER.supervise,
      SERVER.superviseAdr,
      DESIGN.server,
    ],
  },

  // ── Surfaces into the engine ─────────────────────────────────────────────
  {
    id: "cli-compiler",
    from: "cli",
    to: "compiler",
    kind: "local",
    label: "`ork validate`",
    detail:
      "The CLI parses the file with the schema, compiles the graph and prints every diagnostic with its file, line and column; the exit code is 1 when there is an error.",
    via: [
      [570, 384],
      [570, 156],
    ],
    docs: [CLI.validate, CORE.compile, DESIGN.cli],
  },
  {
    id: "cli-scheduler",
    from: "cli",
    to: "scheduler",
    kind: "local",
    label: "`ork run` · stop · resume",
    detail:
      "`ork run` hosts the engine in its own process for the length of the run, in the foreground or detached.",
    docs: [CLI.runWorkflow, DESIGN.cli],
  },
  {
    id: "cli-decisions",
    from: "cli",
    to: "decisionQueue",
    kind: "local",
    label: "`ork decide`",
    detail:
      "An interactive picker over every open decision of live runs; the answer goes to the store and the run is woken on its socket.",
    status: "built",
    via: [
      [570, 396],
      [570, 636],
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "server-scheduler",
    from: "server",
    to: "scheduler",
    kind: "local",
    label: "start · resume · run control · message",
    detail:
      "The server hosts no engine: it starts and resumes runs as detached `ork` processes, and a stop, pause, continue or message is a row in the store plus a wake on the run's socket, as `ork stop`, `ork pause`, `ork continue` and `ork chat -m` do.",
    status: "built",
    docs: [SERVER.writes, SERVER.remote, DESIGN.server],
  },
  {
    id: "server-decisions",
    from: "server",
    to: "decisionQueue",
    kind: "local",
    label: "answers",
    detail:
      "An answer through the API goes to the store as the UI's (the first answer wins) and wakes the run on its socket, as `ork decide` does; the inbox panel is next.",
    status: "built",
    docs: [SERVER.writes, DESIGN.messaging],
  },
  {
    id: "server-worktrees",
    from: "server",
    to: "worktreeMgr",
    kind: "local",
    label: "Remove… · Clean merged…",
    detail:
      "The Worktrees panel's routes read and plan through the same core functions as `ork worktrees`, then remove only what the person confirmed, against the digest of the plan shown. A worktree whose run is still going is always kept.",
    status: "built",
    docs: [
      WORKTREES.routes,
      WORKTREES.clean,
      WORKTREES.remove,
      WORKTREES.routeTests,
    ],
  },
  {
    id: "events-server",
    from: "eventStore",
    to: "server",
    kind: "event",
    label: "SSE event stream",
    detail:
      "The server replays a run's events after `Last-Event-ID`, then follows new ones over the run's socket (or polls the store without one), so a browser that connects late sees the whole run.",
    status: "built",
    via: [
      [580, 996],
      [580, 776],
    ],
    docs: [SERVER.streams, DESIGN.messaging],
  },

  {
    id: "cli-links",
    from: "cli",
    to: "links",
    kind: "local",
    label: "`ork relay`",
    detail:
      "Only you make links, from `ork relay` or the server's `POST /api/links`. Both nodes must be leaders or workers of live runs whose rules allow links.",
    via: [
      [554, 424],
      [554, 1250],
    ],
    docs: [LINKS.command, LINKS.spec],
  },

  // ── Inside the engine ────────────────────────────────────────────────────
  {
    id: "compiler-schema",
    from: "compiler",
    to: "schema",
    kind: "local",
    label: "parse + validate",
    detail:
      "The schema turns YAML into a typed workflow, or into diagnostics with line numbers; the compiler then checks the graph.",
    docs: [SCHEMA.yaml],
  },
  {
    id: "scheduler-context",
    from: "scheduler",
    to: "contextCompiler",
    kind: "local",
    label: "a node's session spec",
    detail:
      "Before starting an agent node, the scheduler asks for its compiled context: layers, brief, model and limits.",
    docs: [CONTEXT.resolver, DESIGN.context],
  },
  {
    id: "scheduler-worktrees",
    from: "scheduler",
    to: "worktreeMgr",
    kind: "local",
    label: "isolation per node",
    detail:
      "A writing node gets a worktree on a branch from its owner's; when the child passes, Ork merges it into the owner's.",
    via: [
      [848, 420],
      [848, 876],
    ],
    docs: [WORKTREES.workspace, DESIGN.worktrees],
  },
  {
    id: "scheduler-nodes",
    from: "scheduler",
    to: "nodeTypes",
    kind: "local",
    label: "Claude, tool, gate, call nodes",
    detail:
      "The scheduler runs each activation through its node type's executor: a Claude session, a tool node's command, a gate's question, a call's run. Joins, routers and splits are the scheduler's own.",
    via: [
      [834, 428],
      [834, 1116],
    ],
    docs: [SCHEMA.nodes],
  },
  {
    id: "scheduler-runtime",
    from: "scheduler",
    to: "runtimeAdapter",
    kind: "local",
    label: "`start(SessionSpec)`",
    detail:
      "The scheduler starts one session per running agent node, with its working directory, model, budget and tools.",
    docs: [DESIGN.runtime],
  },
  {
    id: "scheduler-events",
    from: "scheduler",
    to: "eventStore",
    kind: "event",
    label: "node and usage events",
    detail:
      "Starts, finishes, routing decisions, rounds, escalations and token usage are appended as they happen.",
    status: "built",
    docs: [DESIGN.eventStore, STORE.recorder],
  },
  {
    id: "decisions-events",
    from: "decisionQueue",
    to: "eventStore",
    kind: "event",
    label: "opened · answered",
    detail:
      "Every decision is logged when it opens and when it is answered or times out.",
    docs: [DESIGN.messaging],
  },
  {
    id: "bus-runtime",
    from: "messageBus",
    to: "runtimeAdapter",
    kind: "local",
    label: "`Session.send` at the next step",
    detail:
      "A notice reaches the receiving session at its next step, mid-turn, never in the middle of a tool call.",
    status: "built",
    docs: [DESIGN.messaging],
  },

  {
    id: "nodes-calls",
    from: "nodeTypes",
    to: "calls",
    kind: "local",
    label: "`calls.invoke`",
    detail:
      "The `workflow.call` executor renders the workflow, project, inputs and ref from the run, and hands them to the run's call port.",
    via: [[860, 1136]],
    docs: [CALLS.node],
  },
  {
    id: "scheduler-calls",
    from: "scheduler",
    to: "calls",
    kind: "local",
    label: "budget · stop all",
    detail:
      "No call starts once the budget is spent, and a call passes on what is left. Stopping the run, or an expired run timeout, stops every run it called and is still running.",
    via: [
      [800, 446],
      [826, 446],
      [826, 1100],
    ],
    docs: [CALLS.spec],
  },
  {
    id: "calls-cli",
    from: "calls",
    to: "cli",
    kind: "process",
    label: "starts `ork run`, detached",
    detail:
      "Each new run is its own process, with `--called-by`, `--budget-cap` and `--base-ref`. It refuses to start on what `ork run` refuses, such as a dirty tree, and the node fails with the reason.",
    via: [
      [562, 1100],
      [562, 410],
    ],
    docs: [CALLS.start, CALLS.host],
  },
  {
    id: "calls-events",
    from: "calls",
    to: "eventStore",
    kind: "event",
    label: "`parent` · `depth`",
    detail:
      "The called run's record says who called it and how deep. The caller records `call.started`, which is how `ork resume` finds that run again. A waiting call follows the run's events over its socket, falling back to the store.",
    docs: [CALLS.wait, CALLS.tests],
  },
  {
    id: "calls-links",
    from: "calls",
    to: "links",
    kind: "local",
    label: "links a channel",
    detail:
      "Starting a call that names a `node` links that node to this run's nodes on a channel to the call. Links are ended when the caller stops; a run joined only with `ork relay` is left alone.",
    via: [[780, 1228]],
    docs: [CALLS.talk],
  },
  {
    id: "bus-links",
    from: "messageBus",
    to: "links",
    kind: "local",
    label: "to `<run>/<node>`",
    detail:
      "The sender's run checks the link, records `message.sent`, and writes a `relay` command for the other run. A message from the other side comes back the same way, into this run's bus.",
    both: true,
    via: [
      [1112, 530],
      [1112, 1236],
    ],
    docs: [LINKS.relay, LINKS.tests],
  },
  {
    id: "links-events",
    from: "links",
    to: "eventStore",
    kind: "local",
    label: "a row · a command",
    detail:
      "The link is a row in the `links` table. A `relay` or `notice` command is a row for the other run, followed by a wake on its socket.",
    via: [
      [840, 1210],
      [840, 1016],
    ],
    docs: [LINKS.store, LINKS.control],
  },

  // ── Engine to your machine ───────────────────────────────────────────────
  {
    id: "schema-files",
    from: "schema",
    to: "workflowFiles",
    kind: "file",
    label: "reads and writes `*.ork.yaml`",
    detail:
      "Parsing keeps line numbers for diagnostics; writing produces the canonical form, so saving twice changes nothing.",
    docs: [SCHEMA.yaml, SCHEMA.tests],
  },
  {
    id: "context-layers",
    from: "contextCompiler",
    to: "orkLayers",
    kind: "file",
    label: "Ork, user, workflow skills",
    detail:
      "Reads the layers above the project and writes the winning skills into the node's plugin folder.",
    docs: [CONTEXT.session, DESIGN.context],
  },
  {
    id: "context-project",
    from: "contextCompiler",
    to: "projectFiles",
    kind: "file",
    label: "lists project skills",
    detail:
      "Lists the checkout's `.claude/skills` to find which project skills a higher layer shadows; it never copies or changes the project's files.",
    via: [
      [1130, 276],
      [1130, 756],
    ],
    docs: [DESIGN.context],
  },
  {
    id: "worktree-git",
    from: "worktreeMgr",
    to: "worktrees",
    kind: "git",
    label: "`git worktree add` · merge",
    detail:
      "Creates a worktree and branch per writing node beside the clone, commits leftovers, merges children into their owner's branch with `--no-ff`, and removes merged ones after the run.",
    docs: [WORKTREES.manager, DESIGN.worktrees],
  },
  {
    id: "events-runstore",
    from: "eventStore",
    to: "runStore",
    kind: "file",
    label: "SQLite + JSONL",
    detail:
      "Each event goes to `~/.ork/state.db` and to the run's `events.jsonl`.",
    status: "built",
    docs: [DESIGN.eventStore, STORE.recorder],
  },
  {
    id: "nodes-tools",
    from: "nodeTypes",
    to: "toolClis",
    kind: "process",
    label: "`gh …` · `aws …` · programs",
    detail:
      "Runs the program with templated arguments and no shell, refusing any subcommand outside the node's `allow` list.",
    docs: [SCHEMA.nodes, README.accounts],
  },

  // ── Claude runtime ───────────────────────────────────────────────────────
  {
    id: "runtime-cli",
    from: "runtimeAdapter",
    to: "cliDriver",
    kind: "local",
    label: "`driver: claude-code`",
    detail:
      "Named per node or in `defaults.driver`, or with `ork run --driver claude-code`; with none named, the one ready here (`--driver` is checked before the run starts).",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "runtime-runner",
    from: "runtimeAdapter",
    to: "sessionRunner",
    kind: "local",
    label: "`start(spec)`",
    detail:
      "A session starts through the adapter registered under the driver's id; the runner does the rest once for every driver.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "runner-cli",
    from: "sessionRunner",
    to: "cliDriver",
    kind: "local",
    label: "strategies",
    detail:
      "The `claude-code` adapter supplies the command, decoder, flag-based MCP wiring, permission prompt and usage; the runner runs them.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "runner-command",
    from: "sessionRunner",
    to: "commandDriver",
    kind: "local",
    label: "strategies · lease",
    detail:
      "The `command-code` adapter supplies its own strategies, with a per-checkout lease as its MCP wiring.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "runner-open",
    from: "sessionRunner",
    to: "openDriver",
    kind: "local",
    label: "strategies · config file",
    detail:
      "The `open-code` adapter supplies its own strategies, with a 0600 config file as its MCP wiring.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "contract-runner",
    from: "contractSuite",
    to: "sessionRunner",
    kind: "local",
    label: "every adapter, on a fake",
    detail:
      "The suite drives each adapter through the runner against a fake of its tool; a registered adapter with no entry fails it.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "tools-report",
    from: "mcpTools",
    to: "reportTool",
    kind: "local",
    label: "no `reportSchema`",
    detail:
      "The registry binds `report` only for a driver without structured output.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "cli-session",
    from: "cliDriver",
    to: "session",
    kind: "process",
    label: "`claude -p` stream-json",
    detail:
      "Spawns your `claude` with JSON streams on stdin and stdout, and Ork's tools passed with `--mcp-config`.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "session-mcp",
    from: "session",
    to: "mcpTools",
    kind: "mcp",
    label: "Ork tool calls",
    detail:
      "The session calls `send_message`, `report`, `ask_user` and the rest like any other tool.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "mcp-bus",
    from: "mcpTools",
    to: "messageBus",
    kind: "local",
    label: "send_message · read_inbox",
    detail:
      "Hands the message to the bus, which checks the address and keeps it in the receiver's inbox.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "mcp-decisions",
    from: "mcpTools",
    to: "decisionQueue",
    kind: "local",
    label: "ask_user · permission",
    detail:
      "Opens a decision and holds the tool call open until it is answered, so the session waits.",
    docs: [DESIGN.messaging],
  },
  {
    id: "mcp-scheduler",
    from: "mcpTools",
    to: "scheduler",
    kind: "local",
    label: "delegate · spawn_worker",
    detail:
      "Leaders delegate to declared children or spawn more instances of a child worker; the call blocks until every child has reported. A node's report is its structured output, which the scheduler routes.",
    status: "built",
    via: [
      [1410, 516],
      [1410, 456],
      [862, 456],
      [862, 412],
    ],
    docs: [DESIGN.concepts],
  },
  {
    id: "session-project",
    from: "session",
    to: "projectFiles",
    kind: "file",
    label: "loads instructions, skills",
    detail:
      "Claude Code reads the repo's `CLAUDE.md` (or `AGENTS.md` when there is none) and `.claude/` itself, from the project and local setting sources.",
    docs: [DESIGN.context],
  },
  {
    id: "session-worktree",
    from: "session",
    to: "worktrees",
    kind: "file",
    label: "edits code in its cwd",
    detail:
      "A writing node's file edits land in its own worktree; a `readonly` node's write tools are denied.",
    docs: [DESIGN.concepts],
  },
  {
    id: "session-model",
    from: "session",
    to: "model",
    kind: "net",
    label: "model calls",
    detail:
      "With your API key, cloud provider or `claude` login. Ork never sees the credential.",
    docs: [README.accounts],
  },

  // ── Watching a source ────────────────────────────────────────────────────
  {
    id: "scheduler-watch",
    from: "scheduler",
    to: "nodeWatch",
    kind: "local",
    label: "a node with `watch:`",
    detail:
      "An activation with a `watch:` runs its executor once per look, not once. It's one activation: `runs` is 1, and `round` doesn't change between looks.",
    status: "built",
    docs: [WATCH.execute, WATCH.node],
  },
  {
    id: "watch-nodes",
    from: "nodeWatch",
    to: "nodeTypes",
    kind: "local",
    label: "each look",
    detail:
      "Each look is the node's own call, under the node's own `timeout`, so every integration, `allow` rule and declared output works unchanged. A look past that timeout counts as failed.",
    status: "built",
    via: [
      [856, 276],
      [856, 1108],
    ],
    docs: [WATCH.node, WATCH.tests],
  },
  {
    id: "user-watch",
    from: "user",
    to: "watchCmd",
    kind: "human",
    label: "`ork watch` · `--accept`",
    detail:
      "You start and stop it, and accept each trigger in a terminal on this machine. Without a terminal, or inside a run in a store that run guards (ADR-089), `--accept` refuses.",
    status: "built",
    via: [[150, 1356]],
    docs: [WATCH.command, WATCH.guide],
  },
  {
    id: "watch-watcher",
    from: "watchCmd",
    to: "watcher",
    kind: "local",
    label: "`tick()` every 10 s",
    detail:
      "The process takes the lock and asks the watcher what's due every 10 seconds, passing in how to look and how to start.",
    status: "built",
    docs: [WATCH.command, WATCH.watcher],
  },
  {
    id: "watch-cli",
    from: "watchCmd",
    to: "cli",
    kind: "process",
    label: "`ork run --expect-workflow`",
    detail:
      "A run it starts is an ordinary detached `ork run`, of the file that was accepted, by its whole path. A file whose text has changed since is refused, and nothing starts.",
    status: "built",
    via: [
      [290, 1340],
      [290, 420],
    ],
    docs: [WATCH.start, WATCH.expect, WATCH.cliTests],
  },
  {
    id: "watcher-trust",
    from: "watcher",
    to: "triggerTrust",
    kind: "local",
    label: "live, new or changed",
    detail:
      "A trigger that's new, or whose hash isn't the accepted one, isn't due: it doesn't look at all. Accepting it anew also takes it back to a first look.",
    status: "built",
    docs: [WATCH.watcher, WATCH.trust],
  },
  {
    id: "trust-files",
    from: "triggerTrust",
    to: "triggerFiles",
    kind: "file",
    label: "reads and hashes",
    detail:
      "Each project's `triggers.yaml` and the text of each workflow it starts, read fresh every time. A file that can't be read turns off what's in it, and is said in `--status`.",
    status: "built",
    docs: [WATCH.project, WATCH.trust],
  },
  {
    id: "watcher-store",
    from: "watcher",
    to: "eventStore",
    kind: "local",
    label: "seen keys · lock · hashes",
    detail:
      "The store's `triggers`, `trigger_seen` and `watch_lock` tables: what was accepted, each key seen and the run it started, and which process is watching. The lock is a row, not a file.",
    status: "built",
    via: [
      [572, 1340],
      [572, 1016],
    ],
    docs: [WATCH.store, WATCH.lock],
  },
  {
    id: "watcher-nodes",
    from: "watcher",
    to: "nodeTypes",
    kind: "local",
    label: "a check, no session",
    detail:
      "A look runs the trigger's check with a node's executor, and nobody to ask: it reads the list `{ events: [{ key, inputs }] }`, or fails and starts nothing. A trigger's MCP check hasn't been run end to end.",
    status: "built",
    via: [
      [850, 1330],
      [850, 1144],
    ],
    docs: [WATCH.look, WATCH.cliTests],
  },
  {
    id: "server-watcher",
    from: "server",
    to: "watcher",
    kind: "local",
    label: "`GET /api/triggers`",
    detail:
      "How the triggers stand, from each project's file and this machine's store, for the Runs panel's Triggers section. It only reads: accepting takes a terminal.",
    status: "built",
    via: [
      [548, 784],
      [548, 1376],
    ],
    docs: [WATCH.route, WATCH.status, WATCH.section],
  },
];
