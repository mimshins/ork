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
    status: "built",
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
    detail: "Goes through the bus, pushed in full rather than as a notice.",
    status: "specified",
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
