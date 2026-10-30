/**
 * @file The messaging map's components: you, the commands and panels you answer
 *   and chat from, the engine's bus and decision queue, the runtime's side of
 *   messaging, and three node sessions from the `software-factory` example.
 *   Coordinates are in map units; the map is {@link SIZE} wide and tall.
 */

import { CLI, CONTROL, DESIGN, RUNTIME, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1700, h: 960 };

/**
 * The columns, left to right.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "people", label: "You", x: 20, w: 260, tone: "violet" },
  { id: "surfaces", label: "CLI and UI", x: 300, w: 260, tone: "blue" },
  { id: "core", label: "Ork engine", x: 580, w: 540, tone: "orange" },
  { id: "runtime", label: "Runtime", x: 1140, w: 260, tone: "teal" },
  { id: "sessions", label: "Node sessions", x: 1420, w: 260, tone: "amber" },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [];

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "you",
    title: "You",
    sub: "chat · answer · allow",
    zone: "people",
    x: 40,
    y: 480,
    status: "external",
    pkg: null,
    summary:
      "You talk to any node while it runs, and answer every question the run raises, from the terminal or the browser.",
    facts: ["Your messages and answers are delivered before any node's."],
    docs: [DESIGN.messaging],
  },

  // ── CLI and UI ───────────────────────────────────────────────────────────
  {
    id: "chatCmd",
    title: "ork chat",
    sub: "`ork chat <run> <node>`",
    zone: "surfaces",
    x: 320,
    y: 240,
    status: "specified",
    pkg: "cli",
    summary:
      "Sends a message to a node's live session, or resumes a finished one with its session id to continue the conversation.",
    facts: ["The UI's chat panel does the same, one conversation per node."],
    docs: [DESIGN.messaging, DESIGN.cli],
  },
  {
    id: "decideCmd",
    title: "ork decide",
    sub: "answer every pending decision",
    zone: "surfaces",
    x: 320,
    y: 600,
    status: "built",
    pkg: "cli",
    src: "packages/cli/src/commands/control.ts",
    summary:
      "Lists every open decision of this project's live runs and lets you answer each with its options; the recommended one is preselected.",
    facts: [
      "`ork decide <run>` limits it to one run, `--all` to every project; `--id … --choose …` answers without a prompt.",
      "The first answer wins, whether from here or the run's own terminal.",
    ],
    docs: [DESIGN.cli, CONTROL.commands, CONTROL.cliTests],
  },
  {
    id: "inbox",
    title: "UI decisions inbox",
    sub: "question · options · one click",
    zone: "surfaces",
    x: 320,
    y: 720,
    status: "planned",
    pkg: "ui",
    summary:
      "The browser view of the same decisions, shaped like a question tool: the question, its options with descriptions, the recommended one marked.",
    facts: ["Milestone 2."],
    see: [{ map: "architecture", node: "ui", label: "The UI" }],
    docs: [DESIGN.ui],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "addr",
    title: "Address check",
    sub: "ownership tree + channels",
    zone: "core",
    x: 600,
    y: 120,
    status: "specified",
    pkg: "core",
    summary:
      "Decides whether a message may be sent at all. Parent and child may always talk; any other pair needs a `messages:` channel in the workflow.",
    facts: [
      "In software-factory, `security` and `code` share a channel; `ux` can reach only `builder`.",
      "A refused message is an error returned to the sender's tool call.",
    ],
    docs: [DESIGN.messaging, SCHEMA.example],
  },
  {
    id: "bus",
    title: "Message bus",
    sub: "in-process · logged",
    zone: "core",
    x: 600,
    y: 240,
    status: "specified",
    pkg: "core",
    summary:
      "Carries messages between sessions, and from you to a session. It checks the address, logs the message, and hands it to the receiver's queue.",
    facts: [
      "Lives in the engine's process; no broker.",
      "`read_inbox` returns messages a session has not seen yet.",
    ],
    see: [
      {
        map: "architecture",
        node: "messageBus",
        label: "The bus in the architecture",
      },
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "queue",
    title: "Priority gate",
    sub: "one queue per session",
    zone: "core",
    x: 880,
    y: 240,
    status: "specified",
    pkg: "core",
    summary:
      "Holds messages for a session that is busy, and releases them between turns, highest priority first.",
    facts: [
      "Order: your messages and decision answers, then node messages.",
      "Nothing interrupts a tool call in progress.",
    ],
    docs: [DESIGN.messaging],
  },
  {
    id: "decisions",
    title: "Decision queue",
    sub: "ask_user · permission · gates",
    zone: "core",
    x: 600,
    y: 600,
    status: "built",
    pkg: "core",
    src: "packages/core/src/control/queue.ts",
    summary:
      "Every open question for you. The node that asked waits; the answer goes back to exactly that call.",
    facts: [
      "Question, options (each with an optional description), recommended option, context; stored in `~/.ork/state.db`.",
      "Optional `timeout` and `default` for unattended runs; a withdrawn question is closed unanswered.",
      "Other processes write answers to the store and wake the run on its socket.",
    ],
    see: [
      {
        map: "architecture",
        node: "decisionQueue",
        label: "The decision queue in the architecture",
      },
      {
        map: "feedback",
        node: "decisions",
        label: "Proposed fixes and publish previews",
      },
    ],
    docs: [DESIGN.messaging, CONTROL.queue, CONTROL.control, CONTROL.tests],
  },
  {
    id: "events",
    title: "Run events",
    sub: "`msg.sent` · `decision.*`",
    zone: "core",
    x: 880,
    y: 840,
    status: "specified",
    pkg: "core",
    summary:
      "Messages and decisions are events like everything else, so the chat and decision history of a run can be replayed.",
    facts: ["Chats in the UI are views over these events."],
    see: [
      { map: "feedback", node: "events", label: "Feedback from run events" },
    ],
    docs: [DESIGN.messaging],
  },

  // ── Runtime ──────────────────────────────────────────────────────────────
  {
    id: "sessionSend",
    title: "Session.send",
    sub: "inject at a safe boundary",
    zone: "runtime",
    x: 1160,
    y: 240,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "Delivers a message into a running session as a new user message, between turns.",
    facts: [
      "SDK: the next item of the session's input stream.",
      "CLI: a JSON line on `claude`'s stdin.",
    ],
    docs: [RUNTIME.sdk, RUNTIME.cli, DESIGN.runtime],
  },
  {
    id: "mcpTools",
    title: "Ork MCP tools",
    sub: "ask · send · read · claim",
    zone: "runtime",
    x: 1160,
    y: 480,
    status: "partial",
    pkg: "runtime-claude",
    summary:
      "How a session reaches the rest of the run: ordinary tool calls that Ork answers.",
    facts: [
      "Built: `ask_user(question, options, recommended, context)`; the CLI answers it on the terminal until the decision queue.",
      "Specified: `send_message(to, body)`, `read_inbox()`, `claim`, `release`. The report is structured output, not a tool.",
      "Built, for leaders: `delegate([{ child, brief }])` and `spawn_worker([{ template, brief }])`, blocking until every child has reported.",
      "`feedback(kind, target, …)` reports what got in the way, capped per session.",
    ],
    see: [
      {
        map: "architecture",
        node: "mcpTools",
        label: "The tools in the architecture",
      },
      { map: "feedback", node: "tool", label: "The feedback tool" },
    ],
    docs: [RUNTIME.tools, RUNTIME.delegate, DESIGN.messaging],
  },
  {
    id: "permission",
    title: "Permission gate",
    sub: "`canUseTool` · prompt tool",
    zone: "runtime",
    x: 1160,
    y: 720,
    status: "partial",
    pkg: "runtime-claude",
    summary:
      "When a session wants a tool its rules neither allow nor deny, the question comes to Ork instead of a terminal prompt, and becomes a decision.",
    facts: [
      "SDK: the `canUseTool` callback.",
      "CLI: `--permission-prompt-tool mcp__ork__permission`.",
      "The node's `tools.allow` and `tools.deny` decide first.",
      "Built: both drivers route the prompt to the human channel; `ork run` asks on the terminal and denies when no one is there. Decisions arrive with the queue.",
    ],
    docs: [RUNTIME.sdk, RUNTIME.mcp, CLI.human, DESIGN.runtime],
  },

  // ── Node sessions ────────────────────────────────────────────────────────
  {
    id: "builderS",
    title: "builder",
    sub: "leader · long-lived session",
    zone: "sessions",
    x: 1440,
    y: 240,
    status: "external",
    pkg: null,
    summary:
      "The owner of the reviewers. It can always message them and they it; it delegates, receives their reports and handles their escalations.",
    facts: ["You can chat with it while it works."],
    docs: [SCHEMA.example],
  },
  {
    id: "securityS",
    title: "security",
    sub: "worker · readonly",
    zone: "sessions",
    x: 1440,
    y: 480,
    status: "external",
    pkg: null,
    summary:
      "A reviewer that may message its owner and, over the declared channel, `code`.",
    facts: ["Starts fresh each review round."],
    docs: [SCHEMA.example],
  },
  {
    id: "codeS",
    title: "code",
    sub: "worker · readonly",
    zone: "sessions",
    x: 1440,
    y: 720,
    status: "external",
    pkg: null,
    summary:
      "A reviewer. In these journeys it receives a message, asks you a question, and asks permission for a command.",
    facts: [
      "`readonly`: its write tools are denied, so it never edits the builder's branch.",
    ],
    docs: [SCHEMA.example],
  },
];
