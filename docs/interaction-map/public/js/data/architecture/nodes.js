/**
 * @file The architecture map's components: you, the two surfaces and the
 *   server, the engine, the files and CLIs on your machine, the Claude runtime,
 *   and the model providers. Coordinates are in map units; the map is
 *   {@link SIZE} wide and tall. Rows sit at y 120, 240, … 1080.
 */

import {
  CLI,
  CORE,
  DESIGN,
  ENGINE,
  NODE_TYPES,
  README,
  RUNTIME,
  SCHEMA,
} from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 2260, h: 1240 };

/**
 * The columns, left to right.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "people", label: "People", x: 20, w: 260, tone: "violet" },
  { id: "surfaces", label: "CLI and UI", x: 300, w: 260, tone: "blue" },
  { id: "core", label: "Ork engine", x: 580, w: 540, tone: "orange" },
  { id: "machine", label: "Your machine", x: 1140, w: 260, tone: "slate" },
  { id: "runtime", label: "Claude runtime", x: 1420, w: 540, tone: "teal" },
  { id: "outside", label: "Model providers", x: 1980, w: 260, tone: "amber" },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [
  {
    id: "runtimePkg",
    label: "@krapht/ork-runtime-claude",
    x: 1425,
    y: 210,
    w: 530,
    h: 362,
  },
  {
    id: "sessionProc",
    label: "one process per node",
    x: 1425,
    y: 700,
    w: 250,
    h: 112,
  },
];

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── People ───────────────────────────────────────────────────────────────
  {
    id: "user",
    title: "You",
    sub: "designs, runs, answers",
    zone: "people",
    x: 40,
    y: 600,
    status: "external",
    pkg: null,
    summary:
      "The developer who designs workflows, runs them on their own machine with their own accounts, and answers the questions agents ask. Ork never asks for, stores or relays a credential.",
    facts: [
      "Signs in to each tool with its own login: `claude` or `ANTHROPIC_API_KEY`, `gh auth login`, `aws sso login` or a profile.",
      "Works from the terminal (`ork …`) or the localhost UI (`ork ui`).",
      "Versions workflows with git like any other file.",
    ],
    docs: [README.accounts, DESIGN.cli],
  },

  // ── CLI and UI ───────────────────────────────────────────────────────────
  {
    id: "cli",
    title: "ork CLI",
    sub: "init · validate · run · decide · chat",
    zone: "surfaces",
    x: 320,
    y: 360,
    status: "partial",
    pkg: "cli",
    src: "packages/cli/src/bin.ts",
    summary:
      "The `ork` command. It validates and runs workflows with the engine embedded in its own process, or talks to a running `ork ui` server over HTTP.",
    facts: [
      "Built: `ork init` scaffolds `.ork/` and never overwrites a file; `ork validate` prints schema and graph diagnostics with file, line and column; `ork doctor` reports your own logins and never prints a token or your email.",
      "Built: `ork run <wf>` runs a whole workflow through the scheduler, and `--node <id>` one Claude node; questions and permission prompts are answered on the terminal.",
      "Specified: `ps`, `logs --follow`, `tree`, `stop`, `resume` to watch and steer runs.",
      "`ork decide` answers pending decisions; the recommended option is preselected.",
      "`ork context explain <wf> <node>` shows the resolved layer stack for one node.",
    ],
    see: [{ map: "lifecycle", node: "cli", label: "The CLI in a run" }],
    docs: [
      CLI.validate,
      CLI.init,
      CLI.doctor,
      CLI.run,
      CLI.runWorkflow,
      CLI.human,
      CLI.tests,
      CLI.runTests,
      DESIGN.cli,
    ],
  },
  {
    id: "server",
    title: "Local server",
    sub: "`ork ui` · REST + SSE · 127.0.0.1",
    zone: "surfaces",
    x: 320,
    y: 720,
    status: "planned",
    pkg: "server",
    summary:
      "A Hono server started by `ork ui`. It hosts the same engine as the CLI, serves the built UI, and streams run events to it.",
    facts: [
      "Binds to `127.0.0.1` only and requires a per-start token.",
      "REST for commands (run, stop, answer, chat); SSE for the event stream.",
      "The CLI uses it when it is running, and embeds the engine otherwise.",
      "Milestone 2.",
    ],
    docs: [DESIGN.packages, DESIGN.milestones],
  },
  {
    id: "ui",
    title: "Web UI",
    sub: "designer · monitor · inbox · chats",
    zone: "surfaces",
    x: 320,
    y: 960,
    status: "planned",
    pkg: "ui",
    summary:
      "The localhost UI: a canvas designer that saves the same YAML and layout files, plus live panels for the run, the decisions inbox, chats with nodes, logs and the context inspector.",
    facts: [
      "Vite, React, `@xyflow/react`, TanStack Query, zustand.",
      "Saves `<name>.ork.yaml` and `<name>.layout.json`, nothing else.",
      "Panels, in build order: monitor, logs, decisions, chats, designer, context inspector.",
      "Milestone 2.",
    ],
    see: [
      { map: "messaging", node: "inbox", label: "The decisions inbox" },
      { map: "feedback", node: "panel", label: "The feedback panel" },
    ],
    docs: [DESIGN.ui],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "compiler",
    title: "Graph compiler",
    sub: "edges · ownership · expressions",
    zone: "core",
    x: 600,
    y: 120,
    status: "built",
    pkg: "core",
    src: "packages/core/src/graph",
    summary:
      "Turns a parsed workflow into a run graph and rejects what cannot run: unbounded cycles, unknown parents, missing message targets, bad templates and `when:` predicates.",
    facts: [
      "Every cycle needs an edge with `maxRounds`.",
      "A `claude.subagent` needs a Claude parent; tool and control nodes own nothing.",
      "Templates and predicates use a small expression language: paths, comparisons, `&&`, `||`, `!`, and `any`, `all`, `count`, `len`, `contains`; no arbitrary JavaScript.",
      "Template references must resolve: declared inputs, existing nodes, known report fields; reading a node that does not run first is a warning.",
      "Entry nodes: no incoming flow edge and no parent.",
    ],
    see: [
      { map: "lifecycle", node: "compiler", label: "The compiler in a run" },
    ],
    docs: [CORE.compile, CORE.flow, CORE.expr, CORE.tests, DESIGN.format],
  },
  {
    id: "schema",
    title: "Workflow schema",
    sub: "Zod model · canonical YAML",
    zone: "core",
    x: 880,
    y: 120,
    status: "built",
    pkg: "schema",
    src: "packages/schema/src",
    summary:
      "The workflow file format: a Zod model of workflows, nodes, edges and layouts, a parser that reports errors with line numbers, and a serializer whose output is byte-stable.",
    facts: [
      "Ten node types, from `claude.leader` to `human.gate`, each a strict object.",
      "Edge shorthand `a, b -> c, d` expands to every pair.",
      "Canonical form: fixed key order, edges as shorthand where possible; comments are not kept.",
      "Publishes `workflow.schema.json` for editor autocomplete; a test fails when it is stale.",
    ],
    docs: [SCHEMA.workflow, SCHEMA.nodes, SCHEMA.yaml, SCHEMA.tests],
  },
  {
    id: "scheduler",
    title: "Scheduler",
    sub: "runs nodes · routes outputs",
    zone: "core",
    x: 600,
    y: 360,
    status: "partial",
    pkg: "core",
    summary:
      "The heart of a run. It starts entry nodes, follows flow edges whose `when:` holds, waits on joins, counts loop rounds, and escalates to the owner when a node hits a limit.",
    facts: [
      "Built: activations, edges that fire on success unless `when:` says otherwise, dead-path skips, joins, routers, loop rounds, the run budget and concurrency, interrupt.",
      "Built: every state change is a run event; `ork run` prints them, the event store (M1d) will keep them.",
      "Built: a loop out of rounds asks you; escalation to the owner comes with delegation.",
      "Specified: ownership (`delegate`, `spawn_worker` up to `maxWorkers`), worktrees per node.",
    ],
    see: [
      { map: "lifecycle", node: "scheduler", label: "The scheduler in a run" },
    ],
    docs: [ENGINE.scheduler, ENGINE.routing, ENGINE.tests, DESIGN.scheduler],
  },
  {
    id: "contextCompiler",
    title: "Context compiler",
    sub: "layers → one session spec",
    zone: "core",
    x: 880,
    y: 240,
    status: "specified",
    pkg: "core",
    summary:
      "Builds what one node's session sees: the five layers of skills and instructions resolved by precedence, the owner's brief, and the limits, ordered so the prompt cache hits.",
    facts: [
      "Precedence, low to high: Ork built-ins, user, project, workflow, node.",
      "Adds `AGENTS.md` itself only when the repo has no `CLAUDE.md`.",
      "Writes Ork, user, workflow and node skills into a per-run local plugin.",
    ],
    see: [
      { map: "context", label: "The context map" },
      { map: "feedback", node: "compiler", label: "Where lessons load" },
    ],
    docs: [DESIGN.context],
  },
  {
    id: "messageBus",
    title: "Message bus",
    sub: "checked addressing · priority",
    zone: "core",
    x: 880,
    y: 480,
    status: "specified",
    pkg: "core",
    summary:
      "Carries messages between node sessions. It checks every address against the ownership tree and the `messages:` channels, and queues a message until the receiving session is between turns.",
    facts: [
      "Parent and child may always talk; siblings only over a declared channel.",
      "User messages and decision answers go first.",
      "Every message is an event.",
    ],
    see: [{ map: "messaging", node: "bus", label: "The bus in detail" }],
    docs: [DESIGN.messaging],
  },
  {
    id: "decisionQueue",
    title: "Decision queue",
    sub: "questions waiting for you",
    zone: "core",
    x: 880,
    y: 600,
    status: "specified",
    pkg: "core",
    summary:
      "Every question for you, from every node: `ask_user` calls, permission prompts and `human.gate` nodes. The asking node waits until it is answered or times out.",
    facts: [
      "A decision has a question, options, a recommended option and context.",
      "An optional `timeout` and `default` let unattended runs continue.",
      "Answered from `ork decide` or the UI inbox.",
    ],
    see: [
      { map: "messaging", node: "decisions", label: "Decisions in detail" },
      {
        map: "feedback",
        node: "decisions",
        label: "Proposed fixes and publish previews",
      },
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "worktreeMgr",
    title: "Worktree manager",
    sub: "one worktree per writing node",
    zone: "core",
    x: 880,
    y: 840,
    status: "specified",
    pkg: "core",
    summary:
      "Gives each node with `isolation: worktree` its own git worktree and branch, based on its owner's branch, and cleans them up after the run.",
    facts: [
      "`shared` works in the owner's checkout; `readonly` shares it with write tools denied.",
      "Owners merge their children's branches.",
      "Claims (`claim`, `release`) keep parallel workers off the same files.",
    ],
    docs: [DESIGN.concepts],
  },
  {
    id: "nodeTypes",
    title: "Node types",
    sub: "Claude · tool · gate nodes",
    zone: "core",
    x: 880,
    y: 1080,
    status: "built",
    pkg: "nodes",
    summary:
      "What each built-in node type does when it runs. Claude nodes run a session through the runtime; tool nodes run your own CLIs; gates ask you. Control nodes are the scheduler's own.",
    facts: [
      "`tool.gh`, `tool.aws`, `tool.shell` run a program with arguments, no shell, limited to an `allow` list of subcommands.",
      "`control.join` waits for all, any or `n` inputs; `control.router` follows the first or every matching edge.",
      "`human.gate` asks you, with `timeout` and `default` answering by themselves; the decision inbox comes in M1d.",
      "Output over 64 KiB is cut, and the full text kept under `.ork/runs/`.",
    ],
    docs: [
      NODE_TYPES.claude,
      NODE_TYPES.tools,
      NODE_TYPES.gate,
      NODE_TYPES.tests,
      DESIGN.scheduler,
    ],
  },
  {
    id: "eventStore",
    title: "Event store",
    sub: "append-only run events",
    zone: "core",
    x: 600,
    y: 960,
    status: "specified",
    pkg: "core",
    summary:
      "Every change in a run, appended in order: nodes starting and finishing, messages, tool calls, usage, decisions. Logs, the monitor, chats and replay are all views over it.",
    facts: [
      "Events such as `node.started`, `msg.sent`, `tool.called`, `usage`, `decision.opened`.",
      "Usage comes from each session's final result, so sub-agent tokens count.",
      "Streamed to the UI over SSE.",
    ],
    see: [
      { map: "feedback", node: "events", label: "Feedback from run events" },
    ],
    docs: [DESIGN.messaging],
  },

  // ── Your machine ─────────────────────────────────────────────────────────
  {
    id: "workflowFiles",
    title: "Workflow files",
    sub: "`.ork/workflows/*.ork.yaml`",
    zone: "machine",
    x: 1160,
    y: 120,
    status: "built",
    pkg: null,
    summary:
      "The workflow itself, committed with the project: nodes, ownership, edges, inputs, layers. Canvas positions live in a separate `<name>.layout.json` so logic diffs stay clean.",
    facts: [
      "Formatted only by Ork's serializer, never by a general formatter.",
      "Secrets appear only as `env:` references; no absolute paths.",
      "`schemaVersion` with migrations.",
    ],
    docs: [SCHEMA.example, DESIGN.format, SCHEMA.jsonSchema],
  },
  {
    id: "orkLayers",
    title: "Ork skill layers",
    sub: "built-ins · `~/.ork` · workflow",
    zone: "machine",
    x: 1160,
    y: 240,
    status: "specified",
    pkg: null,
    summary:
      "The skills and context Ork adds on top of the project's own: the `ork:*` built-ins, your user layer in `~/.ork/skills` and `~/.ork/context`, and the workflow's `layers:`.",
    facts: [
      "Built-in skills are namespaced `ork:*`.",
      "Workflow layers are paths relative to the workflow file.",
    ],
    see: [{ map: "context", node: "builtins", label: "The layers in order" }],
    docs: [DESIGN.context],
  },
  {
    id: "projectFiles",
    title: "Project instructions",
    sub: "CLAUDE.md · AGENTS.md",
    zone: "machine",
    x: 1160,
    y: 720,
    status: "external",
    pkg: null,
    summary:
      "The repo's own agent setup, untouched by Ork: `CLAUDE.md`, `AGENTS.md`, `.claude/skills` and `.claude/agents`. Claude Code loads it natively inside each session.",
    facts: [
      "Loaded with `settingSources: ['project', 'local']`; your user settings are never mixed in.",
      "`project.instructions` and `project.skills` in the workflow can inherit, ignore or allow-list it.",
    ],
    see: [
      { map: "context", node: "project", label: "The project layer" },
      { map: "feedback", node: "repoFiles", label: "What a fix changes" },
    ],
    docs: [DESIGN.context],
  },
  {
    id: "worktrees",
    title: "Git worktrees",
    sub: "`.ork/worktrees/` · a branch each",
    zone: "machine",
    x: 1160,
    y: 840,
    status: "specified",
    pkg: null,
    summary:
      "The checkouts writing nodes work in. Each is a `git worktree` on its own branch, so parallel workers never edit the same files.",
    facts: [
      "Git-ignored.",
      "Removed when the run finishes, unless kept for inspection.",
    ],
    docs: [DESIGN.concepts],
  },
  {
    id: "runStore",
    title: "Run store",
    sub: "`~/.ork/state.db` · events.jsonl",
    zone: "machine",
    x: 1160,
    y: 960,
    status: "specified",
    pkg: null,
    summary:
      "Where runs persist: events in SQLite at `~/.ork/state.db`, plus a JSONL copy and the run's artifacts under `.ork/runs/<runId>/`.",
    facts: [
      "`.ork/runs/` is git-ignored.",
      "Large node outputs are stored as artifacts and passed by path, not inlined.",
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "toolClis",
    title: "Your tool CLIs",
    sub: "`gh` · `aws` · any program",
    zone: "machine",
    x: 1160,
    y: 1080,
    status: "external",
    pkg: null,
    summary:
      "The command-line tools tool nodes run, signed in with your own accounts. Ork passes arguments, never a shell, and never touches their credentials.",
    facts: [
      "`gh` uses `gh auth login`; `aws` uses SSO or a profile (`profile`, `region` on the node).",
      "`ork doctor` reports whether each one is installed and signed in.",
    ],
    see: [{ map: "feedback", node: "gh", label: "Publishing feedback" }],
    docs: [README.accounts],
  },

  // ── Claude runtime ───────────────────────────────────────────────────────
  {
    id: "runtimeAdapter",
    title: "Runtime adapter",
    sub: "`ClaudeRuntime` · `Session`",
    zone: "runtime",
    x: 1440,
    y: 360,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "One interface over two drivers. The engine starts a session from a session spec and gets back normalized events, a way to send messages between turns, interrupt and resume.",
    facts: [
      "`start(spec, human)` takes the cwd, model, brief, system prompt addition, setting sources, tool rules, limits and the report schema.",
      "Both drivers emit the same normalized events: started, text, tool called, tool result, finished with the outcome and usage.",
      "`Session.send` injects a message between turns; `interrupt()` stops the session.",
      "Each node picks its driver with `driver: sdk | cli`; `ork run --driver` overrides it.",
    ],
    docs: [RUNTIME.port, RUNTIME.plan, RUNTIME.tests, DESIGN.runtime],
  },
  {
    id: "mcpTools",
    title: "Ork MCP tools",
    sub: "ask · permission · message",
    zone: "runtime",
    x: 1440,
    y: 480,
    status: "partial",
    pkg: "runtime-claude",
    summary:
      "The tools every Claude node gets for working inside the hierarchy: messaging, reporting, delegating, asking you, and claiming files.",
    facts: [
      "Built: `ask_user` (question, two to four options, recommended) and, for the CLI driver, `permission`; arguments are validated with Zod.",
      "Specified: `send_message`, `read_inbox`, `claim`, `release`, `feedback`. The report is structured output, not a tool.",
      "Leaders also get `delegate` and `spawn_worker`.",
      "In-process for the SDK driver; for the CLI driver, a local MCP server on 127.0.0.1 behind a per-session bearer token.",
    ],
    see: [
      {
        map: "messaging",
        node: "mcpTools",
        label: "The tools in a conversation",
      },
      { map: "feedback", node: "tool", label: "The feedback tool" },
    ],
    docs: [RUNTIME.tools, RUNTIME.mcp, DESIGN.messaging, DESIGN.runtime],
  },
  {
    id: "sdkDriver",
    title: "SDK driver",
    sub: "Claude Agent SDK · API key",
    zone: "runtime",
    x: 1720,
    y: 240,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "Runs a node with the Claude Agent SDK's `query()` in streaming input mode. The clearly supported path: an API key, Bedrock or Vertex.",
    facts: [
      "Refuses to start without `ANTHROPIC_API_KEY` or Bedrock, Vertex or Foundry; it never falls back to a claude.ai login.",
      "Permission prompts arrive in `canUseTool` and go to the human channel.",
      "Ork's tools are an in-process server from `createSdkMcpServer`.",
      "`maxTurns`, `maxBudgetUsd` and `resume` map to the node's limits.",
    ],
    docs: [RUNTIME.sdk, RUNTIME.tests, DESIGN.runtime, README.accounts],
  },
  {
    id: "cliDriver",
    title: "CLI driver",
    sub: "`claude -p` · stream-json",
    zone: "runtime",
    x: 1720,
    y: 480,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "Runs a node through your installed `claude` command in headless mode, with JSON streams in and out. Uses whatever login that `claude` has.",
    facts: [
      "`--input-format stream-json --output-format stream-json --verbose`.",
      "The report comes back through `--json-schema`; Ork's tools through `--mcp-config`.",
      "Permission prompts go to `--permission-prompt-tool mcp__ork__permission`.",
      "Anthropic's terms on subscription logins in third-party tools apply; see the README.",
    ],
    docs: [
      RUNTIME.cli,
      RUNTIME.mcp,
      RUNTIME.tests,
      DESIGN.runtime,
      README.accounts,
    ],
  },
  {
    id: "session",
    title: "Claude session",
    sub: "Claude Code agent loop",
    zone: "runtime",
    x: 1440,
    y: 720,
    status: "external",
    pkg: null,
    summary:
      "One Claude Code agent loop per running node: it calls the model, uses tools in its working directory, and calls Ork's tools to talk to the rest of the run.",
    facts: [
      "Works in its node's worktree or shared checkout.",
      "Sub-agents (`claude.subagent`) run inside their parent's session, not as their own process.",
      "Workers start fresh for every task; only leaders live long.",
    ],
    docs: [DESIGN.runtime, DESIGN.concepts],
  },

  // ── Model providers ──────────────────────────────────────────────────────
  {
    id: "model",
    title: "Claude API",
    sub: "Anthropic · Bedrock · Vertex",
    zone: "outside",
    x: 2000,
    y: 720,
    status: "external",
    pkg: null,
    summary:
      "Where the model runs. Sessions reach it with the credential you configured: an API key, a cloud provider, or the `claude` CLI's own login.",
    facts: [
      "Per-node `model`; reviewers and sub-agents default to cheaper models.",
      "Prompt caching is automatic; Ork orders prompts so the stable prefix is cached.",
    ],
    docs: [README.accounts, DESIGN.context],
  },
];
