/**
 * @file The messaging map's components: you, the commands and panels you answer
 *   and chat from, the engine's bus and decision queue, the runtime's side of
 *   messaging, three node sessions from the `software-factory` example, and the
 *   links that reach a node of another run. Coordinates are in map units; the
 *   map is {@link SIZE} wide and tall.
 */

import {
  BUS,
  CALLS,
  CLI,
  CONTROL,
  DESIGN,
  LINKS,
  NODE_TYPES,
  QUESTIONS,
  RUNTIME,
  SCHEMA,
  STORE,
  UI,
} from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1700, h: 1200 };

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
    src: "packages/cli/src/commands/decide.ts",
    summary:
      "Lists every open decision of this project's live runs and lets you answer each with its options; the recommended one is preselected.",
    facts: [
      "`ork decide <run>` limits it to one run, `--all` to every project; `--id … --choose …` answers without a prompt.",
      "The first answer wins, whether from here or the run's own terminal.",
      "`--say <text>` gives the answer a note, which goes to the run with it.",
      "`--note <text>` and `--rating good|bad` note how the node did, as your feedback, once the answer is taken.",
      "`--list` shows a question a leader passed on as `<node> via <leader>`.",
      "`--workflow <name>` keeps one workflow's decisions, ANDed with a run. `--list` marks a decision with a document `+document`.",
      "A gate's document is printed before the question when it is 40 lines or fewer, offered with `d` when longer, and printed by `--id … --document`, all as plain text.",
    ],
    docs: [
      DESIGN.cli,
      CONTROL.commands,
      CONTROL.cliTests,
      CONTROL.say,
      CONTROL.document,
      CONTROL.documentCli,
    ],
  },
  {
    id: "inbox",
    title: "UI decisions inbox",
    sub: "question · options · one click",
    zone: "surfaces",
    x: 320,
    y: 720,
    status: "built",
    pkg: "ui",
    summary:
      "The browser view of the same decisions, shaped like a question tool: the question, its options with descriptions, the recommended one marked.",
    facts: [
      "Every open decision across runs, answered with a click, a digit, or Enter on the card for the recommended one.",
      "An optional note box sends your words with the answer; keys typed in it stay in it.",
      "A card stays until the stream says it settled, and a refusal stays in it in the server's words.",
      "Settled lists who answered, in the run's terminal, with `ork decide` or in `ork ui`, and what they said.",
      'A question a leader passed on says "passed on by" the leader; one it answered is settled "by" the leader, "its owner".',
      "A decision reads as Markdown, never raw HTML, with long text folded and code blocks you can copy. A gate's document opens in a dialog.",
      "Filters by workflow and run, kept per browser; a Monitor control opens one run's decisions.",
    ],
    see: [{ map: "architecture", node: "ui", label: "The UI" }],
    docs: [
      DESIGN.ui,
      UI.guide,
      UI.panels,
      UI.decisions,
      UI.decisionTests,
      UI.decisionReading,
      UI.decisionFilters,
    ],
  },
  {
    id: "relayCmd",
    title: "ork relay",
    sub: "`<run>/<node>` `<run>/<node>`",
    zone: "surfaces",
    x: 320,
    y: 960,
    status: "built",
    pkg: "cli",
    src: "packages/cli/src/commands/relay.ts",
    summary:
      "Introduces two running nodes of different runs, so they can message each other. Only you make links: an agent cannot.",
    facts: [
      "`ork relay end <a> <b>` ends a link; `ork relay list [run]` lists them. `--max-messages` sets the limit.",
      "The server's `POST /api/links` does the same.",
      "Refused for a node that is not a leader or worker, a run that is not running, or a run whose rules turn links off.",
    ],
    docs: [LINKS.command, LINKS.cliTests, LINKS.guide],
  },

  {
    id: "orkSend",
    title: "ork send",
    sub: "from a tool node's program",
    zone: "surfaces",
    x: 320,
    y: 120,
    status: "built",
    pkg: "cli",
    src: "packages/cli/src/commands/send.ts",
    summary:
      "A program tells a session a fact with no model turn. It prints nothing when it works, as what it prints would be its node's output.",
    facts: [
      "It runs inside a tool node, and reads `ORK_RUN` and `ORK_NODE`, which are attribution, not proof.",
      "It exits 1 with the reason on stderr for a run that is not running, a recipient that is not a contact, 100 messages sent, or a message over 64 KiB.",
      "It masks its message before the store, with the names in `ORK_MASKED`.",
    ],
    docs: [BUS.scriptsSpec, BUS.sendCommand, BUS.send, BUS.sendTests],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "notifyRules",
    title: "notify: rules",
    sub: "a message a workflow declares",
    zone: "core",
    x: 880,
    y: 120,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/rules.ts",
    summary:
      "A node's rules send a message when it finishes, after `node.finished` and before its edges are routed, with no model turn and no session started.",
    facts: [
      "Once per fresh result: a result a resumed run hands back does not fire again.",
      "A node a stopping run cuts off fires nothing; `ork stop --node` does.",
      "`when:` and `body:` also read `ok` and `error`. With no body, Ork writes one line on the result.",
      "A body is masked before the inbox, and cut at 64 KiB.",
    ],
    docs: [BUS.scriptsSpec, BUS.rules, BUS.ruleTests],
  },
  {
    id: "addr",
    title: "Address check",
    sub: "ownership tree + channels",
    zone: "core",
    x: 600,
    y: 120,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/contacts.ts",
    summary:
      "Decides whether a message may be sent at all. Owner and child may always talk; any other pair needs a `messages:` channel in the workflow.",
    facts: [
      "One pure function decides for the bus and for `ork send`.",
      "A tool node may write to its owner and its channels, one way: a session cannot write back to a program.",
      "In software-factory, `security` and `code` share a channel; `ux` can reach only `builder`.",
      "A refused message returns the reason and whom the sender can reach.",
      "A spawned worker has its template's owner and channels, both ways.",
      "A name with a slash is a node of another run, which needs a link; without a slash it means this run.",
    ],
    docs: [
      DESIGN.messaging,
      BUS.contacts,
      BUS.bus,
      BUS.tests,
      SCHEMA.example,
      LINKS.spec,
    ],
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
      "A message from `ork send` or a `notify:` rule is labelled `via` in `read_inbox`, `ork logs` and the panels, and holds no more authority than an agent's.",
      "It reaches other runs through links: each run has its own bus, and each run's events hold its side of the conversation.",
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
      "A message that arrives while a session writes its final report gets one more turn of that session, so it is not lost.",
      "`ork resume` hands back unread messages and queued chat messages, those from a linked run too.",
      "`wait_for_messages` blocks until a message lands here, Ork has something to tell the session, or the time passes; the session gives up its slot meanwhile.",
    ],
    docs: [DESIGN.messaging, BUS.bus, BUS.tests, NODE_TYPES.claude],
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
      "Question, options (each with an optional description), recommended option, context, and a gate's optional document; stored in `~/.ork/state.db`, the document kept out of `decision.opened`.",
      "A gate's question and document render readably, lists and objects as Markdown, never raw JSON; a permission's context is its command as written, up to 4,000 characters.",
      "Optional `timeout` and `default` for unattended runs; a withdrawn question is closed unanswered.",
      "Other processes write answers to the store and wake the run on its socket.",
      "An answer may carry a note, stored masked: a gate outputs it, `ask_user` returns it, a denied tool's message ends with it.",
      "With `questions: owner` on a leader, a child's `ask_user` goes first to a read-only fork of the leader's session, which answers it or passes it on with a note. Gates and permission prompts always come to you.",
      "Each answer records who gave it: `terminal`, `decide`, `ui`, or `owner`, with the leader that answered named in `owner`.",
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
        label: "Proposed fixes: keep or discard",
      },
    ],
    docs: [
      DESIGN.messaging,
      CONTROL.queue,
      CONTROL.control,
      CONTROL.tests,
      CONTROL.notesAdr,
      QUESTIONS.spec,
      QUESTIONS.adr,
    ],
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
      "`message.sent`, `message.received`, `message.read`, `link.notice`, `owner.asked`, `owner.answered`, `owner.unanswered`, `decision.opened`, `decision.answered`, `decision.withdrawn`.",
      "`decision.opened` and `decision.answered` carry `owner` when a leader passed a question on or answered it.",
      "A leader's fork is logged as the leader's own events, with `fork: true` on `session.started` and `session.finished`; its cost counts against the leader.",
      "Chats in the UI are views over these events (milestone 2).",
    ],
    see: [
      { map: "feedback", node: "events", label: "Feedback from run events" },
    ],
    docs: [DESIGN.messaging, STORE.recorder, BUS.tests, STORE.tests],
  },
  {
    id: "links",
    title: "Links",
    sub: "a row in the store · a limit",
    zone: "core",
    x: 600,
    y: 960,
    status: "built",
    pkg: "core",
    src: "packages/core/src/remote/relay.ts",
    summary:
      "The permission for two nodes of different live runs to write to each other: a row in the store's `links` table, so a sender's run checks it without asking the other, and no process has to stay up for it.",
    facts: [
      "Each side is told with a `notice` command and a wake on its socket; a session that starts later finds its linked nodes in its system prompt.",
      "`maxMessages` (default 100, both ways together): at the limit a send is refused, and the sender's run asks you, once, to `extend` or `end`.",
      "A link ends with `ork relay end` or either run, and each peer's live session is told. A send to a finished run is refused and ends the link: a finished session is not resumed on an agent's word.",
      "A peer's message grants no permission, and a link gives no access to the other's checkout and no way to start, stop or decide for its run.",
      "`links: off` in a project's or workflow's rules refuses links to the run.",
    ],
    see: [
      {
        map: "architecture",
        node: "links",
        label: "Links in the architecture",
      },
    ],
    docs: [
      LINKS.relay,
      LINKS.links,
      LINKS.store,
      LINKS.tests,
      LINKS.spec,
      LINKS.adr,
    ],
  },
  {
    id: "peerRun",
    title: "The other run",
    sub: "its own process, bus and inbox",
    zone: "core",
    x: 880,
    y: 960,
    status: "built",
    pkg: "core",
    src: "packages/core/src/control/control.ts",
    summary:
      "The run on the other end of a link, often in another repository. It takes `relay` and `notice` rows from the store, woken on its socket, or by its one-second poll with no socket.",
    facts: [
      "A `relay` row puts the message in the node's inbox as `message.received`, and sends the usual notice.",
      "A `notice` row is pushed into the live session as `link.notice`, and wakes it from `wait_for_messages`.",
      "A message to a node that has ended, in a run still live, waits in its inbox, and the sender is told it may not be read.",
    ],
    docs: [LINKS.control, BUS.bus, LINKS.tests, LINKS.spec],
  },
  {
    id: "callCh",
    title: "Channel to a call",
    sub: "by name · linked on start",
    zone: "core",
    x: 600,
    y: 1080,
    status: "built",
    pkg: "core",
    src: "packages/core/src/run/bus-calls.ts",
    summary:
      "A `messages` channel may name a `workflow.call` that names a node, so an agent writes to `client-kit` with no run id. Starting the call makes the link, and the name then stands for `<run>/<node>`.",
    facts: [
      "A message sent before the call starts waits for it, and its sender is told if it then cannot be sent (L57).",
      "The link takes `maxMessages` from the node. The called workflow needs no change.",
      "Two calls cannot share a channel, since neither side has a session. A compile error stops a channel to a call when the workflow's rules turn links off (`call.links-off`).",
    ],
    see: [
      { map: "architecture", node: "calls", label: "Workflow calls" },
      { map: "roles", node: "call", label: "A call in the flow" },
    ],
    docs: [CALLS.routes, CALLS.talk, BUS.tests, CALLS.tests, CALLS.spec],
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
    pkg: "runtime",
    summary:
      "Delivers a message into a running session as a user message with `priority: next`: Claude Code shows it at the session's next step, even mid-turn, without interrupting a tool call.",
    facts: [
      "A JSON line on `claude`'s stdin.",
      "Checked by hand with `claude` 2.1.314: a message sent during a tool call reached the same turn.",
    ],
    docs: [RUNTIME.cli, DESIGN.runtime],
  },
  {
    id: "mcpTools",
    title: "Ork MCP tools",
    sub: "ask · send · read · claim",
    zone: "runtime",
    x: 1160,
    y: 480,
    status: "built",
    pkg: "runtime",
    summary:
      "How a session reaches the rest of the run: ordinary tool calls that Ork answers.",
    facts: [
      "Built: `ask_user(question, options, recommended, context)`, a decision answered on the terminal or with `ork decide`; it returns the choice and any note. Under a leader with `questions: owner`, the leader's fork may answer it first.",
      "Built: `send_message(to, body)`, `read_inbox()` and `wait_for_messages(timeoutSeconds?)` for every leader and worker, since a link can come later (with `links: off`, only those with someone to reach, or that a program or a rule can write to), and `answer(question, choice, note?)` for leaders.",
      "Built: `claim(resource)` and `release(resource)` for nodes that may write while another does; an overlapping claim is refused with who holds it, and the claimant hears when it is released. A leader's claims are released when `delegate` or `spawn_worker` starts its children, and it claims again before it edits. The report is structured output, not a tool.",
      "Built, for leaders: `delegate([{ child, brief }])` and `spawn_worker([{ template, brief }])`, blocking until every child has reported.",
      "Built: `feedback(kind, target, …)` reports what got in the way, capped at 3 per session.",
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
      LINKS.tools,
      DESIGN.messaging,
    ],
  },
  {
    id: "permission",
    title: "Permission gate",
    sub: "the prompt tool",
    zone: "runtime",
    x: 1160,
    y: 720,
    status: "built",
    pkg: "runtime",
    summary:
      "When a session wants a tool its rules neither allow nor deny, the question comes to Ork instead of a terminal prompt, and becomes a decision.",
    facts: [
      "`--permission-prompt-tool mcp__ork__permission`.",
      "The node's `tools.allow` and `tools.deny` decide first.",
      "The prompt goes to the decision queue: allow or deny, from the terminal or `ork decide`; with no one at a terminal and not detached, it is denied.",
    ],
    docs: [RUNTIME.cli, RUNTIME.mcp, CLI.human, DESIGN.runtime],
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
      "With `questions: owner`, a read-only fork of its latest session takes its reviewers' `ask_user` first: at most 3 turns, no write tools, the run's budget. Its own session is left as it was, so this works while it waits in `delegate`. `software-factory` leaves it at `user`.",
      "Checked against stand-in sessions only; a real fork of a leader waiting in `delegate` is unproven (G25).",
      "You can chat with it while it works, or after, by resuming its session.",
    ],
    docs: [SCHEMA.example, QUESTIONS.spec, QUESTIONS.asks, QUESTIONS.tests],
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
  {
    id: "peerS",
    title: "Linked node",
    sub: "`<run>/<node>` · another run",
    zone: "sessions",
    x: 1440,
    y: 960,
    status: "external",
    pkg: null,
    summary:
      "A leader or worker of another run. To it, a peer's message is an agent's, not yours: a notice, then `read_inbox`, labelled with its sender.",
    facts: [
      "It replies with `send_message`, and can block in `wait_for_messages` for the answer rather than end its session.",
      "It works in its own checkout, under its own project's rules.",
    ],
    docs: [LINKS.guide, LINKS.spec],
  },
];
