/** @file The messaging map's journeys. */

import { DESIGN, LINKS, QUESTIONS, SCHEMA, BUS } from "../refs.js";

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
    id: "leader-first",
    title: "A reviewer asks its leader first",
    who: "code · builder · you",
    summary:
      "With `questions: owner` on `builder`, `code`'s question goes to a fork of `builder`'s session before you; here the fork can't settle it and passes it on.",
    steps: [
      {
        from: "codeS",
        to: "mcpTools",
        title: "`code` calls `ask_user`",
        detail:
          "The same call as when it asks you: a question, options, the recommended one, the context.",
        docs: [QUESTIONS.spec],
      },
      {
        from: "mcpTools",
        to: "builderS",
        title: "A fork of `builder`'s session gets it",
        detail:
          "Ork resumes a copy of `builder`'s latest session, in its checkout, with no write tools and at most 3 turns. `builder`'s own session is left as it was, whether it has ended, as here, or waits in `delegate`.",
        docs: [QUESTIONS.asks, QUESTIONS.forkTests],
      },
      {
        from: "builderS",
        to: "mcpTools",
        title: "The fork reports `ask-user`, with a note",
        detail:
          'Had its brief settled the question, it would report an option instead, and `ask_user` would return "Your owner, `builder`, chose: …" with its note, and nobody would ask you.',
      },
      {
        from: "mcpTools",
        to: "decisions",
        title: "A decision opens, owned by `builder`",
        detail:
          "Its context ends `builder passed this on: <note>`, and `decision.opened` names `builder` as its `owner`.",
        docs: [QUESTIONS.tests],
      },
      {
        from: "you",
        to: "decideCmd",
        title: "You see `code via builder`",
        detail:
          'In `ork decide --list`; the Decisions panel says "passed on by builder".',
      },
      {
        from: "decisions",
        to: "mcpTools",
        title: "Your answer goes back to `code`",
        detail:
          "As when it asks you directly. With no session for `builder` yet, or a fork that fails, you'd have been asked from the start.",
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
        docs: [DESIGN.cli],
      },
      {
        from: "chatCmd",
        to: "bus",
        title: "The bus takes it",
        detail:
          "Through the store and the run's socket; logged as `user.message`. You may write to any leader or worker.",
      },
      {
        from: "bus",
        to: "queue",
        title: "It is pushed in full",
        detail:
          "Your messages are not notices: the builder gets the text itself.",
        docs: [DESIGN.messaging],
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "At the builder's next step",
        detail: "After the tool call it is in; nothing is interrupted.",
      },
      {
        from: "sessionSend",
        to: "builderS",
        title: "The builder reads it",
        detail: "Its replies are its events, streamed to your chat.",
      },
    ],
  },
  {
    id: "from-a-program",
    title: "A program tells a session",
    who: "A tool node's program · a rule · builder",
    summary:
      "A fact a program already has reaches a working session with no model turn: `ork send` from the program, or a `notify:` the workflow declared.",
    steps: [
      {
        from: "orkSend",
        to: "bus",
        title: "A program runs `ork send`",
        detail:
          '`ork send builder -m "lint found 3 problems"`, checked on its own side, so a refusal is an exit code. A `script` row and a wake on the run\'s socket.',
        docs: [BUS.send, BUS.scriptsSpec],
      },
      {
        from: "notifyRules",
        to: "bus",
        title: "Or a node's rule fires",
        detail:
          "When the node finishes, if its `when:` holds, with no model turn. Masked, cut at 64 KiB, and starts no session.",
        docs: [BUS.rules],
      },
      {
        from: "bus",
        to: "queue",
        title: "It lands in the inbox",
        detail:
          "As `via: script` or `via: rule`, which shows in `ork logs` and the panels.",
      },
      {
        from: "queue",
        to: "sessionSend",
        title: "A notice goes out",
        detail: "One line, as for any message; the body waits to be pulled.",
      },
      {
        from: "sessionSend",
        to: "builderS",
        title: "The builder sees it",
        detail:
          "At its next step, with a line that this holds no more authority than an agent's.",
      },
      {
        from: "builderS",
        to: "mcpTools",
        title: "The builder calls `read_inbox`",
        detail: "It pays for the body only when it reads it.",
      },
    ],
  },
  {
    id: "link",
    title: "Two runs talk over a link",
    who: "You · builder · a node of another run",
    summary:
      "You link the builder to a node of a run in another repository; they ask and answer through the store and the runs' sockets, each in its own process.",
    steps: [
      {
        from: "you",
        to: "relayCmd",
        title: "You run `ork relay`",
        detail: "`ork relay <run>/builder <run>/api`, for two running nodes.",
        docs: [LINKS.guide],
      },
      {
        from: "relayCmd",
        to: "links",
        title: "A row in the store",
        detail:
          "The `links` table holds it, with its `maxMessages`. Neither run is asked.",
        docs: [LINKS.spec],
      },
      {
        from: "links",
        to: "peerRun",
        title: "Each side is told",
        detail:
          "A `notice` command and a wake on the socket. The session hears it as `link.notice`, at once if it is blocked in `wait_for_messages`.",
      },
      {
        from: "builderS",
        to: "mcpTools",
        title: "The builder writes to it",
        detail: '`send_message(to: "<run>/api", body: "…")`.',
      },
      {
        from: "mcpTools",
        to: "bus",
        title: "The tool hands it to the bus",
        detail:
          "A name with a slash means another run; without one, this run, as before.",
      },
      {
        from: "bus",
        to: "links",
        title: "The link is checked",
        detail:
          "No live link, a finished run or a used-up limit refuses it, with the reason. Otherwise the message is counted and logged as `message.sent`.",
        docs: [LINKS.relay],
      },
      {
        from: "links",
        to: "peerRun",
        title: "A `relay` row and a wake",
        detail:
          "The other run takes the row when its socket is woken, or at its one-second poll if there is no socket.",
        docs: [LINKS.tests],
      },
      {
        from: "peerRun",
        to: "events",
        title: "It lands in the other inbox",
        detail:
          "Logged there as `message.received`, so each run's events hold its side, and `ork resume` rebuilds the inbox.",
      },
      {
        from: "peerRun",
        to: "peerS",
        title: "A notice, then `read_inbox`",
        detail:
          "It is labelled with its sender, and it is an agent's message: it grants nothing. The reply comes back the same way.",
      },
    ],
  },
];
