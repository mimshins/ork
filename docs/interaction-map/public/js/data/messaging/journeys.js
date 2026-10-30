/** @file The messaging map's journeys. */

import { DESIGN, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "sibling",
    title: "A reviewer messages its sibling",
    who: "security · code",
    summary:
      "`security` tells `code` about a finding they share, over the channel the workflow declares.",
    steps: [
      {
        from: "securityS",
        to: "mcpTools",
        title: "`security` calls `send_message`",
        detail:
          '`send_message(to: "code", body: "…")` in the middle of its review.',
        docs: [DESIGN.messaging],
      },
      {
        from: "mcpTools",
        to: "bus",
        title: "The tool hands it to the bus",
        detail:
          "From the session's node id; a session cannot pretend to be another node.",
      },
      {
        from: "bus",
        to: "addr",
        title: "The address is checked",
        detail:
          "Siblings need a channel: `messages: [{ between: [security, code] }]` is in the workflow, so it passes.",
        docs: [SCHEMA.example],
      },
      {
        from: "bus",
        to: "queue",
        title: "It lands in `code`'s inbox",
        detail: "Logged as `message.sent`; `code` is busy with a tool call.",
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "A notice goes out",
        detail:
          "`[ork] 1 unread message from security. Call read_inbox to read them.`",
      },
      {
        from: "sessionSend",
        to: "codeS",
        title: "`code` sees it at its next step",
        detail:
          "After the tool call it was in, still in the same turn; nothing is interrupted.",
      },
      {
        from: "codeS",
        to: "mcpTools",
        title: "`code` calls `read_inbox`",
        detail:
          "It gets the body, oldest first, when it chooses; logged as `message.read`.",
      },
    ],
  },
  {
    id: "ask-user",
    title: "A reviewer asks you a question",
    who: "code · you",
    summary:
      "`code` is unsure whether a pattern is intended and asks you, with a recommendation, instead of guessing.",
    steps: [
      {
        from: "codeS",
        to: "mcpTools",
        title: "`code` calls `ask_user`",
        detail:
          "A question, two or more options with descriptions, the recommended one, and the context you need to decide.",
        docs: [DESIGN.messaging],
      },
      {
        from: "mcpTools",
        to: "decisions",
        title: "A decision opens",
        detail:
          "Logged as `decision.opened`; the tool call stays open, so `code` waits.",
      },
      {
        from: "you",
        to: "decideCmd",
        title: "You run `ork decide`",
        detail:
          "It shows every open decision, with the recommended option preselected.",
        docs: [DESIGN.cli],
      },
      {
        from: "decideCmd",
        to: "decisions",
        title: "You answer",
        detail: "The decision is resolved and logged.",
      },
      {
        from: "decisions",
        to: "mcpTools",
        title: "The tool call returns your answer",
        detail: "`code` carries on with its review knowing what you meant.",
      },
    ],
  },
  {
    id: "permission",
    title: "A session asks permission",
    who: "code · you",
    summary:
      "`code` wants to run a command its tool rules do not settle; the prompt becomes a decision rather than a stuck terminal.",
    steps: [
      {
        from: "codeS",
        to: "permission",
        title: "Claude Code needs permission",
        detail: "For example a test command not in the node's `tools.allow`.",
        docs: [DESIGN.runtime],
      },
      {
        from: "permission",
        to: "decisions",
        title: "It becomes a decision",
        detail: "Allow or deny, with the exact command as context.",
      },
      {
        from: "you",
        to: "decideCmd",
        title: "You see it with the others",
        detail: "In the same list as questions and gates.",
      },
      {
        from: "decideCmd",
        to: "decisions",
        title: "You allow it",
        detail: "Or deny it; either way the answer is logged.",
      },
      {
        from: "decisions",
        to: "permission",
        title: "The tool call goes ahead",
        detail: "Or is refused, and the session is told why.",
      },
    ],
  },
  {
    id: "chat",
    title: "You chat with the builder",
    who: "You · builder",
    summary:
      "You steer the builder mid-run; your message reaches it at its next step, without interrupting a tool call.",
    steps: [
      {
        from: "you",
        to: "chatCmd",
        title: "You run `ork chat <run> builder`",
        detail: "And type, for example, a constraint the spec missed.",
        status: "specified",
        docs: [DESIGN.cli],
      },
      {
        from: "chatCmd",
        to: "bus",
        title: "The bus takes it",
        detail: "You may message any node; it is logged like any message.",
        status: "specified",
      },
      {
        from: "bus",
        to: "queue",
        title: "It is pushed in full",
        detail:
          "Your messages are not notices: the builder gets the text itself.",
        status: "specified",
        docs: [DESIGN.messaging],
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "At the builder's next step",
        detail: "After the tool call it is in; nothing is interrupted.",
        status: "specified",
      },
      {
        from: "sessionSend",
        to: "builderS",
        title: "The builder reads it",
        detail: "And replies in its next turn; the reply shows in your chat.",
        status: "specified",
      },
    ],
  },
];
