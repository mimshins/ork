# RFC-003 — A relay between runs

- **Status:** Accepted
- **Date:** 2026-11-03
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)

## Context

Work often spans repositories. A change in one project (the maintainer's
`se-backend`) usually needs an agent on another (`se-client-kit`), and sometimes
a third. Today the maintainer opens a session in each, introduces them, and they
work in parallel and message each other. Ork should do that without the human
carrying messages.

This RFC is about sessions in different runs talking while they work. How one
workflow starts another and waits on its result is a separate decision, in
[RFC-004](./RFC-004-workflows-calling-workflows.md), which uses this one to make
links from a workflow file.

What Ork does now, checked on 2026-11-03:

- **Runs in parallel already work.** Four detached runs started within a second
  of each other all succeeded: the same workflow twice in one project, another
  workflow, and one in a second project. Each run has its own process, and
  `ork ps --all` lists them.
- **The message bus stops at the run.** It is in-process, one per run, and
  `send_message` refuses anyone who is not the sender's owner, child or declared
  channel ([bus.ts](../../packages/core/src/run/bus.ts),
  [ADR-025](../../decisions/ADR-025-message-bus.md)).
- **The path between processes exists.** `ork chat` writes a command row to the
  shared store and wakes the run on its socket; the run takes the row and acts
  on it, and polls every second when there is no socket
  ([commands.ts](../../packages/core/src/remote/commands.ts),
  [control.ts](../../packages/core/src/control/control.ts)). `store.command`
  takes any run's id.
- **A session ends when it reports.** One that ends with unread messages is
  resumed once ([claude.ts](../../packages/nodes/src/claude.ts)). There is no
  way to wait for a reply except ending the turn or holding a `delegate` open.

So the gap is small and specific: who may write across runs, how a message gets
there, and how a session stays around for the answer.

## Options

### Option A — A relay between runs

Each repository keeps its own run. Two nodes are **linked**, and each may then
write to the other. A message is a row in the store and a wake on the
recipient's socket, the path `ork chat` already uses.

- **Pros:** Matches how the work happens: separate sessions, introduced when
  needed, including sessions already running. Worktrees, project rules, context
  layers, merges and resume do not change, since every run stays in one
  repository. Needs no new process, and the store remains the record. A run
  started without a thought of the other project can still be linked.
- **Cons:** A budget, a stop and a graph per run, so seeing the whole piece of
  work needs a view over linked runs. Delivery to a run that has finished needs
  a rule.

### Option B — Agents call `ork chat` themselves

No engine change: a skill tells agents to run `ork chat <run> <node> -m "…"`.

- **Pros:** Possible today, on paper; it has not been tried between real
  sessions.
- **Cons:** The message arrives saying the user wrote it, so an agent's words
  carry the user's authority. Nothing limits who may write to whom. It needs
  shell permission for `ork`, gives no way to wait for a reply, and is pushed in
  full rather than as a notice, so every message costs the recipient context.

### Option C — A relay process

A broker runs on its own, and sessions connect to it over a socket or a local
MCP server.

- **Pros:** Could serve sessions Ork did not start, and other machines later.
- **Cons:** Something to start, supervise and upgrade, for a tool that today
  needs no daemon: every run works without `ork ui` running. A second place that
  knows about messages, beside the store that replay, logs and resume already
  read. Ork binds loopback only and has one local user
  ([L28](../../specs/gaps.md)), so the reach adds nothing yet.

## Decision

**Option A**, chosen by the maintainer on 2026-11-03: a link between nodes of
live runs, carried by the store and the runs' sockets.

```sh
cd se-backend    && ork run feature --detach   # run a1
cd se-client-kit && ork run feature --detach   # run b2
ork link a1/builder b2/builder
```

- **A link is the permission.** It joins two nodes, both ways, until
  `ork unlink` or either run ends. It sits in the store, so any process can
  check it. `ork links` lists them; the local server and the UI use the same
  operations.
- **Who makes links.** The user, with `ork link` or the UI, for sessions already
  running; or the user's workflow file, through a call and a `messages` channel
  ([RFC-004](./RFC-004-workflows-calling-workflows.md)). Agents do not.
- **Introduction.** Each session gets a pushed line naming the other node, its
  project and its workflow, and how to write to it. Links can be made while the
  sessions are working, so a session never needs restarting.
- **Addressing.** `send_message(to: "b2/builder", body)`. A name without a slash
  still means this run, so nothing changes for a workflow that uses no links.
- **Delivery.** The sender's process checks the link, records `message.sent` in
  its own run, writes a command row for the recipient's run, and wakes its
  socket. The recipient's run takes the row, puts the message in the node's
  inbox, records it in its own events, and sends the usual notice. Without a
  socket, the recipient's one-second poll finds the row.
- **Trust.** A peer's message is an agent's message: a notice, then
  `read_inbox`, labelled with its sender. It never says the user wrote it, and
  it grants no permission. Bodies are masked like every event. A link lets
  agents talk; it gives neither access to the other's checkout, nor any way to
  start, stop or decide for the other run.
- **Who gets the tools.** Every leader and worker gets `send_message` and
  `read_inbox`, since a session linked later has no other way to write, and a
  session's tool list may not be able to change while it runs. A project rule
  turns that off. The cost in tokens is measured when built.
- **Waiting.** A new tool, `wait_for_messages`, blocks until a message arrives,
  a timeout passes, or the run stops. While it waits the session gives up its
  slot, as a waiting leader does under `delegate`
  ([ADR-017](../../decisions/ADR-017-blocking-delegate.md)). This serves
  channels inside a run too.
- **A cap.** A link has a message limit. Reaching it opens a decision for the
  user to extend the link or end it, as `maxRounds` bounds any other loop.
- **Ending.** When a linked run ends, each peer's live session is told, and
  later writes to it are refused with the reason. A message to a node whose
  session has ended, in a run still live, waits in its inbox and the sender is
  told. A finished run's session is not resumed on an agent's word; the user can
  resume it with `ork chat`.

## Consequences

**Positive**

- The maintainer's way of working becomes one command per session and one link.
- `ork logs` on either run shows both sides of a conversation, and replay and
  resume keep working from the events.
- Two runs in one repository can link too, which gives them a way to coordinate
  though their claims stay separate ([L40](../../specs/gaps.md)).

**Negative**

- Budgets and concurrency stay per run, so linked runs spend independently
  ([L39](../../specs/gaps.md)).
- Two agents answering each other can still spend up to the link's limit before
  anyone is asked.
- Linked work is one machine's, as is everything in Ork for now.
- A blocked tool call on the CLI driver lasts at most 24 hours, as `delegate`
  does ([L6](../../specs/gaps.md)).

**Follow-up work**

- Engine: the store's links and a relay command kind; the bus's cross-run
  addressing, inbound messages and resume state; `wait_for_messages`.
- CLI: `ork link`, `ork unlink`, `ork links`. Server: the same as routes, and
  links in the overview stream.
- UI: Monitor and Chats show a node's links and a way to make one. This work
  lands before the Monitor (M2 task 11); the graph (task 10) does not depend on
  it.
- Specs: [messaging](../../specs/messaging.md), [CLI](../../specs/cli.md),
  [server](../../specs/server.md), [event store](../../specs/event-store.md).
  User guide, interaction map and roadmap. An ADR on shipping, which amends
  ADR-025.
- Prove it on real sessions in two repositories on both drivers, including a
  message pushed into a session in mid-turn and a wait that ends on a reply.
  Everything above about delivery rests on code reading until then.

## Open questions

None for the maintainer. They were answered on 2026-11-03 and are in the
[Decision](#decision). The default for a link's message limit is left to the
build, to be set from real use rather than guessed.
