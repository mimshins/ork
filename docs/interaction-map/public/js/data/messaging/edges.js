/**
 * @file The messaging map's connections. Lanes in use: `x` 296 from you to the
 *   UI inbox; `y` 420 and `x` 1130 from the tools to the bus; `x` 1405 from
 *   `Session.send` down to `code`.
 */

import { DESIGN } from "../refs.js";

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
    status: "specified",
  },
  {
    id: "you-decide",
    from: "you",
    to: "decideCmd",
    kind: "human",
    label: "answers",
    detail: "Pick an option, or accept the recommended one.",
    status: "specified",
  },
  {
    id: "you-inbox",
    from: "you",
    to: "inbox",
    kind: "human",
    label: "answers in the browser",
    detail: "One click per decision.",
    status: "planned",
    via: [
      [296, 536],
      [296, 756],
    ],
  },
  {
    id: "chat-bus",
    from: "chatCmd",
    to: "bus",
    kind: "local",
    label: "user message",
    detail: "Goes through the bus like any message, at the highest priority.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "decide-decisions",
    from: "decideCmd",
    to: "decisions",
    kind: "local",
    label: "resolve",
    detail: "Resolves the decision with your option; the waiting call returns.",
    status: "specified",
  },
  {
    id: "inbox-decisions",
    from: "inbox",
    to: "decisions",
    kind: "net",
    label: "resolve over REST",
    detail: "Through the local server, which resolves the same decision.",
    status: "planned",
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
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "bus-queue",
    from: "bus",
    to: "queue",
    kind: "local",
    label: "enqueue for the receiver",
    detail: "Logged as `msg.sent`, then queued with its priority.",
    status: "specified",
  },
  {
    id: "queue-send",
    from: "queue",
    to: "sessionSend",
    kind: "local",
    label: "between turns",
    detail:
      "When the receiving session finishes a turn, its queue is drained in priority order.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "decisions-events",
    from: "decisions",
    to: "events",
    kind: "event",
    label: "opened · answered",
    detail: "With who asked, what was chosen, and whether a timeout chose it.",
    status: "specified",
  },

  // ── Runtime and sessions ─────────────────────────────────────────────────
  {
    id: "send-builder",
    from: "sessionSend",
    to: "builderS",
    kind: "process",
    label: "new user message",
    detail: "Written to the session's input stream.",
    status: "specified",
    docs: [DESIGN.runtime],
  },
  {
    id: "send-code",
    from: "sessionSend",
    to: "codeS",
    kind: "process",
    label: "new user message",
    detail: "Written to the session's input stream.",
    status: "specified",
    via: [
      [1405, 286],
      [1405, 736],
    ],
  },
  {
    id: "builder-mcp",
    from: "builderS",
    to: "mcpTools",
    kind: "mcp",
    label: "delegate · report",
    detail: "The leader briefs its children and reports to the run.",
    status: "specified",
  },
  {
    id: "security-mcp",
    from: "securityS",
    to: "mcpTools",
    kind: "mcp",
    label: "`send_message`",
    detail:
      "An ordinary tool call; the result says whether the message was accepted.",
    status: "specified",
    docs: [DESIGN.messaging],
  },
  {
    id: "code-mcp",
    from: "codeS",
    to: "mcpTools",
    kind: "mcp",
    label: "`ask_user`",
    detail: "The call stays open until you answer; its result is your answer.",
    status: "specified",
  },
  {
    id: "code-permission",
    from: "codeS",
    to: "permission",
    kind: "process",
    label: "may I run this?",
    detail: "Claude Code asks before a tool call its rules do not settle.",
    status: "specified",
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
    status: "specified",
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
    status: "specified",
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
    status: "specified",
    both: true,
    docs: [DESIGN.messaging],
  },
];
