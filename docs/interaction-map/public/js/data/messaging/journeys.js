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
        status: "specified",
        docs: [DESIGN.messaging],
      },
      {
        from: "mcpTools",
        to: "bus",
        title: "The tool hands it to the bus",
        detail:
          "From the session's node id; a session cannot pretend to be another node.",
        status: "specified",
      },
      {
        from: "bus",
        to: "addr",
        title: "The address is checked",
        detail:
          "Siblings need a channel: `messages: [{ between: [security, code] }]` is in the workflow, so it passes.",
        status: "specified",
        docs: [SCHEMA.example],
      },
      {
        from: "bus",
        to: "queue",
        title: "It waits in `code`'s queue",
        detail:
          "`code` is busy with a tool call; the message is logged and queued.",
        status: "specified",
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "Released between turns",
        detail: "As soon as `code` finishes its turn.",
        status: "specified",
      },
      {
        from: "sessionSend",
        to: "codeS",
        title: "`code` reads it as a new message",
        detail:
          "Its next turn starts with the message, after the cached prefix and what came before.",
        status: "specified",
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
        status: "specified",
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
        status: "specified",
        docs: [DESIGN.runtime],
      },
      {
        from: "permission",
        to: "decisions",
        title: "It becomes a decision",
        detail: "Allow or deny, with the exact command as context.",
        status: "specified",
      },
      {
        from: "you",
        to: "decideCmd",
        title: "You see it with the others",
        detail: "In the same list as questions and gates.",
        status: "specified",
      },
      {
        from: "decideCmd",
        to: "decisions",
        title: "You allow it",
        detail: "Or deny it; either way the answer is logged.",
        status: "specified",
      },
      {
        from: "decisions",
        to: "permission",
        title: "The tool call goes ahead",
        detail: "Or is refused, and the session is told why.",
        status: "specified",
      },
    ],
  },
  {
    id: "chat",
    title: "You chat with the builder",
    who: "You · builder",
    summary:
      "You steer the builder mid-run; your message jumps the queue but still waits for a safe moment.",
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
        title: "It goes to the front",
        detail: "User messages and decision answers come before node messages.",
        status: "specified",
        docs: [DESIGN.messaging],
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "Released at the end of the turn",
        detail: "The builder's current tool call is never interrupted.",
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
