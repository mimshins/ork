# RFC-005 — Scripts and rules on the message bus

- **Status:** Implemented
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-048](../../decisions/ADR-048-scripts-and-rules-on-the-bus.md)

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Settled questions](#settled-questions)

## Context

Today only a Claude session can post to a run's message bus. Telling another
session something therefore takes a model turn, even when nothing needs
judgment: "tests failed, here is the output" is a fact a program already has.

Three things stand in the way:

- **A tool node has no place on the bus.** `peersOf`
  ([bus.ts](../../packages/core/src/run/bus.ts)) filters a node's children to
  those with sessions, and a channel naming a tool node is the compile error
  `message.endpoint` ([nodes.ts](../../packages/core/src/graph/nodes.ts)).
- **A workflow cannot declare a message.** An edge means "start this node". It
  cannot reach a session that is already working.
- **The only way in from outside speaks as the user.** `ork chat` pushes its
  text as `[ork] The user writes to you`. RFC-003 rejected teaching agents to
  use it, and [ADR-047](../../decisions/ADR-047-script-identity-env-json.md) now
  refuses it from a program or an agent in a run, with `ork send` named as the
  way to come.

The parts this builds on exist:

- A program knows `ORK_RUN` and `ORK_NODE` (ADR-047).
- The `relay` command kind writes a row a live run picks up, and `bus.receive`
  lands it as a notice
  ([control.ts](../../packages/core/src/control/control.ts),
  [live-handlers.ts](../../packages/cli/src/run/live-handlers.ts)). Neither does
  anything specific to links on receipt, so a script can reuse them.
- `message.received` is already rebuilt into an inbox on resume
  ([mail.ts](../../packages/core/src/run/mail.ts)).
- `run.started` records each node's parent and the channels, so the sender's
  side can check who it may write to without the compiled graph
  ([types.ts](../../packages/core/src/run/types.ts)).

Both additions post to the same bus under the same trust model, which is why
they share this RFC. How a program gets identity, `env:` and JSON output is
settled in ADR-047 and is not reopened here.

## Options

### How a program sends

#### Option A — A CLI, `ork send`

Check the sender, write a `relay` row, wake the run's socket: the path ADR-044
uses.

- **Pros:** works from any language. A refusal is an exit code the script can
  act on. The store remains the record. With no socket, the one-second poll
  still finds the row.
- **Cons:** `ork` must be reachable, which `ORK_BIN` covers. It reads the run's
  events to check, as `links.ts` already does.

#### Option B — Commands printed on stdout, like `::ork send …::`

- **Pros:** needs no `ork` on the `PATH`.
- **Cons:** any text a program prints can issue a command, including text it
  merely relays. GitHub deprecated `set-env` for this reason. Conflicts with
  JSON on stdout.

#### Option C — A raw `ORK_SOCKET`

- **Pros:** fast, and needs no CLI.
- **Cons:** bypasses the store as the record, has no refusals, and every script
  would need to speak the protocol.

### Whom a program may write to

#### Option A — Its owner and its channels

- **Pros:** the rule agents already follow, so there is one rule. A channel
  states the permission in the workflow file.
- **Cons:** an author must declare a channel to reach a peer.

#### Option B — Any node in the run

- **Pros:** simplest for scripts.
- **Cons:** skips the ownership rules, and a prompt-injected program could write
  to every session.

#### Option C — Its owner only

- **Pros:** the tightest.
- **Cons:** a flow node with no owner could reach nobody.

### Where a rule lives

#### Option A — `notify:` on the sending node

- **Pros:** reads next to the node, and fits a node's schema.
- **Cons:** the rules are spread across the file.

#### Option B — On `messages:` channels

- **Pros:** one section for messaging.
- **Cons:** mixes permission with behavior.

#### Option C — On edges

- **Pros:** the graph shows it.
- **Cons:** an edge means "start this node", and a rule must not.

#### Option D — A top-level `rules:`

- **Pros:** all in one place.
- **Cons:** that word already means a project's rules, and rules sit far from
  their nodes.

## Decision

The author accepted this on 2026-11-04.

**`ork send`:**

```sh
ork send <to> -m <body>   # or --stdin
```

- It runs inside a tool node, and reads `ORK_RUN` and `ORK_NODE`.
- Exit 0 when accepted. Exit 1 with the reason when there is no `ORK_RUN`, the
  run is not running, it is a `--node` run, the recipient is not a contact
  (listing who is), or the sender is over its cap.
- The recipient gets the usual notice and pulls the body. `read_inbox` shows
  `{ from, via: "script", body }`.
- A recipient that is not running gets it when its session starts, and
  `ork resume` keeps it unread.
- A script reads nothing: a tool node is one shot, and nothing can write to it.

**Channels accept a tool node, one way.**
`messages: - between: [tests, builder]` allows `ork send` from `tests`. A
session cannot write to a tool node, and its prompt does not list one, so
`peersOf` filters them out of a session's contacts. One pure function decides
contacts for both the bus and `ork send`.

**`notify:` on the sender:**

```yaml
tests:
  type: tool.shell
  command: ./scripts/check.sh
  notify:
    - to: builder
      when: "!ok" # optional; default: every finish
      body: | # optional; default: Ork's one-line result
        Tests failed:
        {{nodes.tests.output.stderr}}
```

- A rule fires once per fresh result, after `node.finished` and before the
  node's edges are routed, so a node an edge starts already has the message.
- A replayed result does not fire again; a node that really runs again does.
- `to` must be a leader or worker. A rule needs no channel, since the workflow's
  author declared it.
- `when:` reads what an edge's does, plus `ok` and `error`, because a failed
  node may have no output. `when:` and `body:` are checked at compile time like
  an edge's.
- The default body is a pure function of the result: `<id> passed: <summary>`
  for a Claude node, `<id> exited <code>` and the last stderr line for a tool.
- A rule sends through the bus and starts no session.
- A rule on a spawned worker's template fires per instance, with the instance as
  sender. A rule to a template reaches the declared node's inbox only.

**Trust.** Both are labelled and hold no more authority than an agent:

| Source            | Delivered as                | Authority               |
| ----------------- | --------------------------- | ----------------------- |
| User (`ork chat`) | pushed in full, "The user…" | the user's              |
| Agent or link     | notice, then `read_inbox`   | an agent's              |
| Script            | notice, then pull, `via`    | no more than an agent's |
| Rule              | notice, then pull, `via`    | no more than an agent's |

An author wrote the rule, but its body can carry program or model output, so it
must not read as an instruction from the user. A short line in the system
prompt, only for a node that can receive these, says so.

`ORK_RUN` and `ORK_NODE` are attribution, not proof. A program runs as the same
user with the same store, so it can forge them
([L80](../../specs/gaps/limits-scripts.md)). The contact check stops mistakes
and a prompt-injected send to the wrong session; it is not a security boundary.

**A cap on scripts.** 100 per sending node, matching `DEFAULT_LINK_MESSAGES`,
which is equally a first guess. At the cap it refuses and asks nobody. Rules
need no cap: they fire once per activation, so `maxRounds` bounds them.

**Left out.** `ork send` from outside a run (it has no node to check, and
belongs to triggers), across a link or call (links join sessions, and only the
user makes them), and `ork inbox` (send-only for now).

## Consequences

- A deterministic step can report to a working session with no model turn.
- **Cost:** a rule's or a script's message that reaches a session as it ends
  triggers the existing one-time resume for late messages
  ([claude.ts](../../packages/nodes/src/claude.ts)), which spends a turn no
  agent asked for ([settled question 1](#settled-questions)).
- **Context:** every notice costs its recipient a little context. `when:` and
  the cap are the controls.
- **A crash between `node.finished` and `message.sent` loses that message.**
  Each event is written on its own; this goes in the gaps register rather than
  adding a recovery path.
- **Refactoring first:** `scheduler.ts` is at 299 lines and `bus.ts` at 298,
  against a limit of 300. Firing rules and the contact function move out into
  modules of their own.
- **Format:** `notify` and tool nodes in channels are optional additions, so
  `schemaVersion` stays 1. Regenerate the JSON Schema, and add the keys to the
  canonical order and one example.
- **Surfaces:** `via` shows in `ork logs` and the Logs and Chats panels. Rules
  appear in the graph only if the design review finds it clear.
- **`ork chat`'s refusal text** then names a command that exists, closing
  [L84](../../specs/gaps/limits-scripts.md).
- **Follow-up:** update `specs/messaging.md`, `specs/graph-compiler.md`,
  `specs/workflow-format.md` and `specs/cli/running-and-runs.md`, the scripts
  guide and the map, then write the ADR and archive this RFC. A real session on
  the CLI driver must receive both a script's message and a rule's before this
  ships; the SDK driver stays under C5.

## Settled questions

The author settled these on 2026-11-04.

1. **A rule's or script's message triggers the late-message resume,** the same
   as an agent's, so nothing is silently missed. The guide says so, and it can
   be revisited if `ork usage` shows it costing.
2. **`notify:` goes on** Claude leaders and workers, tool nodes, gates and
   calls. Not `claude.subagent`, which runs inside its parent's session, nor
   control nodes, which have no result of their own.
3. **`via` is both** a field in `read_inbox` and one line in the system prompt
   of a node that can receive one.
4. **`ork run --node`** has no bus: a rule does nothing and the command says so
   once, and `ork send` is refused with the reason.
