/**
 * @file The architecture map's connections. Lanes in use: `x` 570 and 580
 *   between the surfaces and the engine; `x` 834, 848 and 862 between the
 *   engine's two columns; `x` 1130 between the engine and your machine; `y` 456
 *   above the message bus; `x` 1410 and 1690 in the runtime. The rows at y 360,
 *   480 and 600 of "Your machine" stay empty so the engine and the runtime can
 *   reach each other straight across.
 */

import { CLI, CORE, DESIGN, README, SCHEMA } from "../refs.js";

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
    status: "specified",
    docs: [DESIGN.cli],
  },
  {
    id: "user-ui",
    from: "user",
    to: "ui",
    kind: "human",
    label: "designs · watches · answers",
    detail:
      "You draw workflows on the canvas, watch a run live, chat with nodes and answer decisions in the browser.",
    status: "planned",
    docs: [DESIGN.ui],
  },
  {
    id: "ui-server",
    from: "ui",
    to: "server",
    kind: "net",
    label: "REST + SSE",
    detail:
      "Commands go over REST with the server's per-start token; the run's events come back over one SSE stream.",
    status: "planned",
    docs: [DESIGN.packages],
  },
  {
    id: "cli-server",
    from: "cli",
    to: "server",
    kind: "net",
    label: "HTTP, when `ork ui` runs",
    detail:
      "When a server is running, the CLI sends its commands there so both surfaces see the same runs; otherwise it embeds the engine.",
    status: "planned",
    docs: [DESIGN.packages],
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
    docs: [CLI.validate, CORE.compile, DESIGN.cli],
  },
  {
    id: "cli-scheduler",
    from: "cli",
    to: "scheduler",
    kind: "local",
    label: "`ork run` · stop · resume",
    detail:
      "With no server running, `ork run` hosts the engine in its own process for the length of the run.",
    status: "specified",
    docs: [DESIGN.cli],
  },
  {
    id: "cli-decisions",
    from: "cli",
    to: "decisionQueue",
    kind: "local",
    label: "`ork decide`",
    detail:
      "An interactive picker over every pending decision; the recommended option is preselected.",
    status: "specified",
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
    label: "run · stop · chat",
    detail:
      "The server hosts the same engine as the CLI and forwards the UI's commands to it.",
    status: "planned",
    docs: [DESIGN.packages],
  },
  {
    id: "server-decisions",
    from: "server",
    to: "decisionQueue",
    kind: "local",
    label: "inbox answers",
    detail:
      "An answer clicked in the UI's decisions inbox resolves the decision and wakes the waiting node.",
    status: "planned",
    docs: [DESIGN.messaging],
  },
  {
    id: "events-server",
    from: "eventStore",
    to: "server",
    kind: "event",
    label: "SSE event stream",
    detail:
      "The server replays a run's events and then follows new ones, so a browser that connects late sees the whole run.",
    status: "planned",
    via: [
      [580, 996],
      [580, 776],
    ],
    docs: [DESIGN.messaging],
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
      "Before starting a Claude node, the scheduler asks for its compiled context: layers, brief, model and limits.",
    status: "specified",
    docs: [DESIGN.context],
  },
  {
    id: "scheduler-worktrees",
    from: "scheduler",
    to: "worktreeMgr",
    kind: "local",
    label: "isolation per node",
    detail:
      "A writing node gets a fresh worktree on a branch from its owner's; the owner merges it when the child reports.",
    status: "specified",
    via: [
      [848, 420],
      [848, 876],
    ],
    docs: [DESIGN.concepts],
  },
  {
    id: "scheduler-nodes",
    from: "scheduler",
    to: "nodeTypes",
    kind: "local",
    label: "tool, control, human nodes",
    detail:
      "Nodes that are not Claude sessions run here: a tool node's command, a join's wait, a router's choice, a gate's decision.",
    status: "specified",
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
      "The scheduler starts one session per running Claude node, with its working directory, model, budget and tools.",
    status: "specified",
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
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "decisions-events",
    from: "decisionQueue",
    to: "eventStore",
    kind: "event",
    label: "opened · answered",
    detail:
      "Every decision is logged when it opens and when it is answered or times out.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "bus-runtime",
    from: "messageBus",
    to: "runtimeAdapter",
    kind: "local",
    label: "`Session.send` between turns",
    detail:
      "A queued message reaches the receiving session only between turns, never in the middle of a tool call.",
    status: "specified",
    docs: [DESIGN.messaging],
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
      "Reads the layers above the project and writes them into a per-run local plugin directory.",
    status: "specified",
    docs: [DESIGN.context],
  },
  {
    id: "context-project",
    from: "contextCompiler",
    to: "projectFiles",
    kind: "file",
    label: "detects CLAUDE.md, AGENTS.md",
    detail:
      "Looks only at what exists, to decide whether to add `AGENTS.md` and which project skills a higher layer shadows; it does not copy the project's files.",
    status: "specified",
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
      "Creates a worktree and branch per writing node, merges children into their owner's branch, and removes them after the run.",
    status: "specified",
    docs: [DESIGN.concepts],
  },
  {
    id: "events-runstore",
    from: "eventStore",
    to: "runStore",
    kind: "file",
    label: "SQLite + JSONL",
    detail:
      "Each event goes to `~/.ork/state.db` and to the run's `events.jsonl`.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "nodes-tools",
    from: "nodeTypes",
    to: "toolClis",
    kind: "process",
    label: "`gh …` · `aws …` · programs",
    detail:
      "Runs the program with templated arguments and no shell, refusing any subcommand outside the node's `allow` list.",
    status: "specified",
    docs: [SCHEMA.nodes, README.accounts],
  },

  // ── Claude runtime ───────────────────────────────────────────────────────
  {
    id: "runtime-sdk",
    from: "runtimeAdapter",
    to: "sdkDriver",
    kind: "local",
    label: "`driver: sdk`",
    detail: "The default driver, set in `defaults.driver` or per node.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "runtime-cli",
    from: "runtimeAdapter",
    to: "cliDriver",
    kind: "local",
    label: "`driver: cli`",
    detail:
      "Chosen per node or in `defaults.driver`, or with `ork run --driver cli`.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "sdk-session",
    from: "sdkDriver",
    to: "session",
    kind: "process",
    label: "`query()` · streaming input",
    detail:
      "The SDK runs the Claude Code loop in a child process; Ork feeds it user messages as an async stream.",
    status: "built",
    via: [
      [1690, 276],
      [1690, 740],
    ],
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
      "Hands the message to the bus, which checks the address and queues it.",
    status: "specified",
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
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "mcp-scheduler",
    from: "mcpTools",
    to: "scheduler",
    kind: "local",
    label: "delegate · spawn_worker",
    detail:
      "Leaders delegate to declared children or spawn workers from a template. A node's report is its structured output, which the scheduler routes.",
    status: "specified",
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
      "Claude Code reads the repo's `CLAUDE.md` and `.claude/` itself, from the project and local setting sources.",
    status: "specified",
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
    status: "specified",
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
    status: "specified",
    docs: [README.accounts],
  },
];
