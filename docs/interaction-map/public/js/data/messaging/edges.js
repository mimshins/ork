/**
 * @file The messaging map's connections. Lanes in use: `x` 288 from you to `ork
 *   relay`; `x` 296 from you to the UI inbox; `y` 420 and `x` 1130 from the
 *   tools to the bus; `x` 850 from the bus down to the links; `x` 1405 from
 *   `Session.send` down to `code`.
 */

import { BUS, CALLS, DESIGN, LINKS } from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "you-chat",
    from: "you",
    to: "chatCmd",
    kind: "human",
    label: "a message to a node",
    detail:
      "Type to any node of a running run, or of a finished one to resume it.",
    status: "built",
  },
  {
    id: "you-decide",
    from: "you",
    to: "decideCmd",
    kind: "human",
    label: "answers",
    detail: "Pick an option, or accept the recommended one.",
    status: "built",
  },
  {
    id: "you-inbox",
    from: "you",
    to: "inbox",
    kind: "human",
    label: "answers in the browser",
    detail: "One click per decision, or a digit with the focus in its card.",
    status: "built",
    via: [
      [296, 536],
      [296, 756],
    ],
  },
  {
    id: "you-relay",
    from: "you",
    to: "relayCmd",
    kind: "human",
    label: "link two nodes",
    detail:
      "Name two running nodes of different runs. Only you make links, and you can end one at any time.",
    via: [
      [288, 530],
      [288, 996],
    ],
  },
  {
    id: "relay-links",
    from: "relayCmd",
    to: "links",
    kind: "local",
    label: "a row, both ways",
    detail:
      "Checks both ends, writes the row to the `links` table, and writes a `notice` command to each side.",
    docs: [LINKS.links, LINKS.cliTests],
  },
  {
    id: "send-bus",
    from: "orkSend",
    to: "bus",
    kind: "local",
    label: "a row, and a wake",
    detail:
      "Checks on the sender's side, writes a `script` command to the store, and wakes the run's socket. The run takes it and files it as `message.received`.",
    docs: [BUS.send, BUS.sendTests],
  },
  {
    id: "rules-bus",
    from: "notifyRules",
    to: "bus",
    kind: "local",
    label: "when a node finishes",
    detail:
      "In-process: a rule that holds goes to the inbox of a leader or worker, as `message.sent` with `via: rule`.",
    docs: [BUS.rules, BUS.ruleTests],
  },
  {
    id: "chat-bus",
    from: "chatCmd",
    to: "bus",
    kind: "local",
    label: "user message",
    detail:
      "A `message` command in the store, picked up when the run is woken; the bus pushes it in full rather than as a notice.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "decide-decisions",
    from: "decideCmd",
    to: "decisions",
    kind: "local",
    label: "resolve",
    detail:
      "Writes your option to the store (first answer wins) and wakes the run on its socket; the waiting call returns.",
    status: "built",
  },
  {
    id: "inbox-decisions",
    from: "inbox",
    to: "decisions",
    kind: "net",
    label: "resolve over REST",
    detail: "Through the local server, which resolves the same decision.",
    status: "built",
    docs: [DESIGN.ui],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "bus-addr",
    from: "bus",
    to: "addr",
    kind: "local",
    label: "may A talk to B?",
    detail:
      "Checked against the ownership tree and the workflow's `messages:` channels before anything is queued.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "bus-queue",
    from: "bus",
    to: "queue",
    kind: "local",
    label: "into the receiver's inbox",
    detail:
      "Logged as `message.sent`, then kept in the receiver's inbox until it reads it.",
    status: "built",
  },
  {
    id: "queue-send",
    from: "queue",
    to: "sessionSend",
    kind: "local",
    label: "a one-line notice",
    detail:
      "Sent at once to a live session (`[ork] 1 unread message from security…`), or when the receiver's session starts.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "decisions-events",
    from: "decisions",
    to: "events",
    kind: "event",
    label: "opened · answered",
    detail:
      "`decision.opened`, `decision.answered` (with who answered) and `decision.withdrawn`.",
    status: "built",
  },

  {
    id: "bus-links",
    from: "bus",
    to: "links",
    kind: "local",
    label: "to `<run>/<node>`",
    detail:
      "The sender's process checks the link, counts the message and records `message.sent`. A message from the other side comes back into this bus the same way.",
    both: true,
    via: [
      [850, 290],
      [850, 940],
      [760, 940],
    ],
    docs: [LINKS.relay],
  },
  {
    id: "links-peer",
    from: "links",
    to: "peerRun",
    kind: "local",
    label: "a row · a wake",
    detail:
      "A `relay` command for the other run, then a wake on its socket. With no socket, its one-second poll finds the row. A link's notices travel the same way, as `notice` commands.",
    both: true,
    docs: [LINKS.relay, LINKS.control, LINKS.tests],
  },
  {
    id: "peer-events",
    from: "peerRun",
    to: "events",
    kind: "event",
    label: "`message.received`",
    detail:
      "Each run's events hold its side of the conversation, and `ork resume` rebuilds the inbox from them.",
    docs: [LINKS.spec],
  },
  {
    id: "call-links",
    from: "callCh",
    to: "links",
    kind: "local",
    label: "linked when it starts",
    detail:
      "Starting the call links the channel's nodes to the called node, and what waited for it is sent. The links end when the caller stops.",
    docs: [CALLS.talk, CALLS.tests],
  },

  // ── Runtime and sessions ─────────────────────────────────────────────────
  {
    id: "send-builder",
    from: "sessionSend",
    to: "builderS",
    kind: "process",
    label: "new user message",
    detail:
      "Written to the session's input stream with `priority: next`, shown at its next step.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "send-code",
    from: "sessionSend",
    to: "codeS",
    kind: "process",
    label: "new user message",
    detail: "Written to the session's input stream.",
    status: "built",
    via: [
      [1405, 286],
      [1405, 736],
    ],
  },
  {
    id: "peer-linked",
    from: "peerRun",
    to: "peerS",
    kind: "process",
    label: "notice · `read_inbox`",
    detail:
      "The usual notice through `Session.send`; the node reads the body with `read_inbox`, labelled with its sender, and replies with `send_message`.",
    both: true,
    docs: [LINKS.spec],
  },
  {
    id: "builder-mcp",
    from: "builderS",
    to: "mcpTools",
    kind: "mcp",
    label: "delegate · report",
    detail:
      "The leader briefs its children through `delegate` and gets their reports back; its own report ends its session.",
    status: "built",
  },
  {
    id: "security-mcp",
    from: "securityS",
    to: "mcpTools",
    kind: "mcp",
    label: "`send_message`",
    detail:
      "An ordinary tool call; the result says whether the message was accepted.",
    status: "built",
    docs: [DESIGN.messaging],
  },
  {
    id: "code-mcp",
    from: "codeS",
    to: "mcpTools",
    kind: "mcp",
    label: "`ask_user`",
    detail: "The call stays open until you answer; its result is your answer.",
    status: "built",
  },
  {
    id: "code-permission",
    from: "codeS",
    to: "permission",
    kind: "process",
    label: "may I run this?",
    detail: "Claude Code asks before a tool call its rules do not settle.",
    status: "built",
    docs: [DESIGN.runtime],
  },
  {
    id: "mcp-bus",
    from: "mcpTools",
    to: "bus",
    kind: "local",
    label: "send_message · read_inbox",
    detail:
      "Hands the message to the bus, or reads the session's unread messages.",
    status: "built",
    via: [
      [1130, 516],
      [1130, 420],
      [690, 420],
    ],
  },
  {
    id: "mcp-decisions",
    from: "mcpTools",
    to: "decisions",
    kind: "local",
    label: "question ⇄ answer",
    detail: "`ask_user` opens a decision and waits for it.",
    status: "built",
    both: true,
  },
  {
    id: "permission-decisions",
    from: "permission",
    to: "decisions",
    kind: "local",
    label: "prompt ⇄ allow or deny",
    detail:
      "The permission request becomes a decision; your answer allows or denies the tool call.",
    status: "built",
    both: true,
    docs: [DESIGN.messaging],
  },
];
