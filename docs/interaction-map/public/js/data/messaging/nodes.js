/**
 * @file The messaging map's components: you, the commands and panels you answer
 *   and chat from, the engine's bus and decision queue, the runtime's side of
 *   messaging, and three node sessions from the `software-factory` example.
 *   Coordinates are in map units; the map is {@link SIZE} wide and tall.
 */

import { BUS, CLI, CONTROL, DESIGN, RUNTIME, SCHEMA, STORE } from "../refs.js";

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
    status: "built",
    pkg: "cli",
    src: "packages/cli/src/commands/chat.ts",
    summary:
      "Sends a message to a node's live session, or resumes a finished one's session where it ran to continue the conversation.",
    facts: [
      "A live run: the message goes to the store, the run is woken on its socket, and the node's replies stream back.",
      "A finished run: the last session is resumed with the run's skills and instructions; the exchange is added to the run's log.",
      "`-m` sends one message. The UI's chat panel (milestone 2) does the same, one conversation per node.",
    ],
    docs: [DESIGN.messaging, DESIGN.cli, BUS.chat, BUS.chatTests],
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
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/bus.ts",
    summary:
      "Decides whether a message may be sent at all. Owner and child may always talk; any other pair needs a `messages:` channel in the workflow.",
    facts: [
      "In software-factory, `security` and `code` share a channel; `ux` can reach only `builder`.",
      "A refused message returns the reason and whom the sender can reach.",
      "A spawned worker has its template's owner and channels, both ways; a node with no one to reach gets no message tools.",
    ],
    docs: [DESIGN.messaging, BUS.bus, BUS.tests, SCHEMA.example],
  },
  {
    id: "bus",
    title: "Message bus",
    sub: "in-process · logged",
    zone: "core",
    x: 600,
    y: 240,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/bus.ts",
    summary:
      "Carries messages between sessions. It checks the address, logs the message as a run event, and puts it in the receiver's inbox.",
    facts: [
      "One per run, in the engine's process; no broker.",
      "`read_inbox` returns the messages a session has not read yet, oldest first.",
      "A loop out of rounds asks the leader that owns its nodes while that leader's session is live; the leader replies with `answer`, and if its session ends first, you are asked.",
      "Your own messages (`ork chat`) are pushed in full, or kept for the node's next session.",
    ],
    see: [
      {
        map: "architecture",
        node: "messageBus",
        label: "The bus in the architecture",
      },
    ],
    docs: [DESIGN.messaging, BUS.bus, BUS.escalation, BUS.tests],
  },
  {
    id: "queue",
    title: "Inbox and notice",
    sub: "notice, then pull",
    zone: "core",
    x: 880,
    y: 240,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/bus.ts",
    summary:
      "Each node's unread messages. A live session gets a one-line notice; it pulls the bodies with `read_inbox` when it chooses, so a busy session pays only for what it reads.",
    facts: [
      "A node that is not running gets the notice when its session starts.",
      "A question to an owner is pushed in full, with its options.",
      "Your messages (`ork chat`) and answers are pushed in full.",
    ],
    docs: [DESIGN.messaging, BUS.bus, BUS.tests],
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
    sub: "`message.*` · `decision.*`",
    zone: "core",
    x: 880,
    y: 840,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/types.ts",
    summary:
      "Messages, owner questions and decisions are events like everything else, stored in the event store, so a run's messages and decisions can be read back with `ork logs`.",
    facts: [
      "`message.sent`, `message.read`, `owner.asked`, `owner.answered`, `owner.unanswered`, `decision.opened`, `decision.answered`, `decision.withdrawn`.",
      "Chats in the UI are views over these events (milestone 2).",
    ],
    see: [
      { map: "feedback", node: "events", label: "Feedback from run events" },
    ],
    docs: [DESIGN.messaging, STORE.recorder, BUS.tests, STORE.tests],
  },

  // ── Runtime ──────────────────────────────────────────────────────────────
  {
    id: "sessionSend",
    title: "Session.send",
    sub: "at the next step",
    zone: "runtime",
    x: 1160,
    y: 240,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "Delivers a message into a running session as a user message with `priority: next`: Claude Code shows it at the session's next step, even mid-turn, without interrupting a tool call.",
    facts: [
      "SDK: the next item of the session's input stream.",
      "CLI: a JSON line on `claude`'s stdin.",
      "Checked by hand with `claude` 2.1.314: a message sent during a tool call reached the same turn.",
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
      "Built: `ask_user(question, options, recommended, context)`, a decision answered on the terminal or with `ork decide`.",
      "Built: `send_message(to, body)` and `read_inbox()` for nodes with someone to reach, and `answer(question, choice)` for leaders.",
      "Built: `claim(resource)` and `release(resource)` for nodes that may write while another does; an overlapping claim is refused with who holds it, and the claimant hears when it is released. The report is structured output, not a tool.",
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
    docs: [
      RUNTIME.tools,
      RUNTIME.delegate,
      BUS.tools,
      BUS.toolTests,
      BUS.claimTools,
      BUS.claims,
      BUS.claimTests,
      BUS.claimAdr,
      DESIGN.messaging,
    ],
  },
  {
    id: "permission",
    title: "Permission gate",
    sub: "`canUseTool` · prompt tool",
    zone: "runtime",
    x: 1160,
    y: 720,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "When a session wants a tool its rules neither allow nor deny, the question comes to Ork instead of a terminal prompt, and becomes a decision.",
    facts: [
      "SDK: the `canUseTool` callback.",
      "CLI: `--permission-prompt-tool mcp__ork__permission`.",
      "The node's `tools.allow` and `tools.deny` decide first.",
      "Both drivers route the prompt to the decision queue: allow or deny, from the terminal or `ork decide`; with no one at a terminal and not detached, it is denied.",
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
    facts: [
      "While it works, Ork asks it, not you, about a loop of the nodes it owns; it replies with `answer`.",
      "You can chat with it while it works, or after, by resuming its session.",
    ],
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
