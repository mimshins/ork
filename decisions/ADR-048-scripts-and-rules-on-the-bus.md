# ADR-048 — Scripts and rules post to the message bus

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** message bus / workflow format / CLI
- **RFC:** [RFC-005](../rfcs/archived/RFC-005-scripts-and-rules-on-the-bus.md)
- **Builds on:** [ADR-044](./ADR-044-relay-between-runs.md) (a row and a wake),
  [ADR-047](./ADR-047-script-identity-env-json.md) (a program's identity)

## Context

Only a Claude session could post to a run's message bus, so telling another
session a fact a program already had took a model turn. A tool node had no place
on the bus, a workflow could not declare a message, and the only way in from
outside spoke as the user.

## Decision

**`ork send <to> -m <body>` or `--stdin`,** from a program in a tool node. It
checks on the sender's side, from `run.started`, so a refusal is an exit code,
then writes a `script` command and wakes the run. It prints nothing when it
works, as what a program prints is its node's output. It is capped at 100
messages per sending node, a first guess matching links, counted with the write,
and at 64 KiB a message, matching a tool's output, as an unbounded message would
fill the store and the recipient's context.

**A tool node's contacts are its owner and its channels, one way.** A channel
accepts a tool node on one side and a leader or worker on the other. A session
cannot write to a tool node and its prompt does not list one. One pure function
decides contacts for the bus and `ork send`.

**`notify:` on the sending node,** on leaders, workers, tool nodes, gates and
calls. A rule fires once per fresh result, after `node.finished` and before the
edges are routed. It goes to a leader or worker, needs no channel, and starts no
session. `when:` and `body:` read what an edge's `when:` does, plus `ok` and
`error`. A node a stopping run cuts off fires nothing: it has not failed, and it
runs again on resume. `ork stop --node` does fire, as the run goes on.

**Both are labelled `via` and hold no more authority than an agent:** a field in
`read_inbox`, and one line in the system prompt of a node that can receive one.
`via` also shows in `ork logs` and the Logs and Chats panels.

**`ork send` masks its body before the store,** with the names in `ORK_MASKED`,
which a tool node's program now gets. They are names, never values. A run a
program starts therefore also masks what its parent does. A rule's body is
masked the same way before it reaches the inbox.

**A `script` command kind,** rather than `relay` with a flag: the commands
table's `kind` is free text, so this needs no migration.

## Options considered

From RFC-005, in full there:

- **Commands printed on stdout, like `::ork send …::`.** Any text a program
  prints could issue a command, and it conflicts with JSON on stdout.
- **A raw `ORK_SOCKET`.** Bypasses the store as the record, with no refusals.
- **Writing to any node in the run.** Simplest, but skips the ownership rules.
- **Rules on channels, on edges, or under a top-level `rules:`.** Each mixes
  permission with behavior, gives an edge a second meaning, or takes a word that
  already means a project's rules.

## Consequences

- A deterministic step can report to a working session with no model turn.
- A message reaching a session as it ends triggers the one-time resume for late
  messages, which spends a turn no agent asked for. Since an agent no longer has
  to ask for it, that turn now stays within what's left of the budgets, and a
  turn with no report leaves the first report standing. The guide says so, and
  it can be revisited if `ork usage` shows it costing.
- Every notice costs its recipient a little context; `when:` and the cap are the
  controls.
- A crash between `node.finished` and `message.sent`, or a row written after a
  run's last look at its commands, loses that message
  ([L87](../specs/messaging/scripts-limits.md)).
- `notify` and tool nodes in channels are optional additions, so `schemaVersion`
  stays 1.
- Rules are not drawn in the graph. That waits for a design review to find it
  clear.
- Proven on a real session on the CLI driver, which received both a script's
  message and a rule's, labelled. The SDK driver stays under C5.
