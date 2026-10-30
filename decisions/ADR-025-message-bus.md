# ADR-025 — Nodes message each other with a notice, then a pull

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / message bus
- **RFC:** waived — the author chose notice-then-pull when the M1d task spec was
  clarified; the options are below

## Context

Nodes in a run could hand work down (`delegate`) and report up, but not tell
each other anything in between: a reviewer could not warn the coder, and a loop
out of rounds always stopped for the human even when the leader that owns the
loop was live and could decide. [specs/messaging.md](../specs/messaging.md)
named a bus checked against the ownership tree and `messages` channels, with
messages delivered between turns.

## Decision

1. **One in-process bus per run** in `core/`
   ([bus.ts](../packages/core/src/run/bus.ts)); each leader and worker gets a
   `Mailbox` through its session's ports.
2. **Addressing:** a node may write to its owner, the nodes it owns (and their
   spawned instances), and its declared channels; peers are mutual, so a node
   with none gets no message tools.
3. **Notice, then pull:** a message lands in the recipient's inbox; a live
   session gets a one-line notice through `Session.send`, and reads the bodies
   with `read_inbox`. Messages and reads are run events, so `ork logs` shows
   them and `ork resume` can rebuild the inboxes.
4. **Mid-turn delivery:** `Session.send` writes the user message with
   `priority: "next"` in both drivers, so Claude Code shows it at the session's
   next step instead of after the turn (checked by hand with `claude` 2.1.314: a
   message sent during a tool call reached the same turn, which ended in one
   result).
5. **Owner questions:** a loop out of rounds asks the owner of its nodes while
   that owner's session is live; the question is pushed in full and answered
   with the `answer` tool. If the owner's session ends first, the human gets it
   as a decision.

## Options considered

- **Delivery:** notice, then pull (chosen: a busy session pays tokens only for
  the bodies it reads); push the whole message (simplest, but every message
  costs every recipient a turn's worth of context); pull only (cheapest, but
  relies on the agent to look).
- **Owner answers:** an `answer` tool on the bus (chosen: the owner stays in its
  session and the scheduler waits on a promise); a decision record the owner
  answers through `ork decide`'s table (one mechanism, but an agent would need a
  store client); always the human (today's behaviour, wasteful when the owner
  knows).

## Rationale

Notices keep messages cheap and visible without trusting agents to poll, and the
bus needs nothing outside the run's process. Asking the live owner first keeps
the human for what only the human can decide.

## Consequences

- The inboxes live in memory; the events are the durable record.
- A notice that lands as a session writes its final report is not seen; the
  message stays unread, and the node sees it if it runs again.
- `ork chat` (M1d) adds user messages on the same path, pushed in full.
