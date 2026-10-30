# Messaging, decisions and logs

Status: **Partial**: `ask_user`, the permission prompt, `delegate`,
`spawn_worker`, `send_message`, `read_inbox` and `answer` are built
([tools/](../packages/runtime-claude/src/tools/registry.ts)), and so are the
[event store](./event-store.md), the decision queue, `ork decide`, `ork stop`,
the run's socket ([control/](../packages/core/src/control/control.ts),
[tests](../packages/core/test/control.test.ts)) and the message bus
([bus.ts](../packages/core/src/run/bus.ts),
[tests](../packages/core/test/bus.test.ts)) with the user's messages
(`ork chat`); `claim` and `feedback` are specified for M1d.

## Ork MCP tools

One registry
([tools/registry.ts](../packages/runtime-claude/src/tools/registry.ts)), one
file per tool, binds the tools each session gets; both drivers serve what it
binds. A node's report is its structured output, not a tool
([runtime](./runtime.md#the-node-report)). Built tools are marked ✓:

- ✓ `send_message(to, body)` and ✓ `read_inbox()`: sessions in a run with
  someone to write to (see below).
- ✓ `answer(question, choice)`: leaders in a run, for the questions Ork asks
  them as owners.
- ✓ `delegate({ tasks: [{ child, brief }] })`: leaders with declared children
  only ([scheduler](./scheduler.md#delegation)).
- ✓ `spawn_worker({ tasks: [{ template, brief }] })`: leaders with a child
  worker and `maxWorkers` left only.
- ✓ `ask_user(question, options[], recommended, context)`
- `claim(resource)` and `release(resource)`
- `feedback(kind, target, title, body, severity, evidence[])`: capped per
  session; see [Feedback and self-improvement](./feedback.md).
- ✓ `permission`: CLI driver only.

Ork's own tools need no permission prompt, except `permission`, which is the
prompt itself.

## Message bus

One per run, in-process in `core/` ([bus.ts](../packages/core/src/run/bus.ts));
the scheduler gives each leader and worker its `Mailbox` through the session's
ports.

- **Who may write to whom:** a node's owner, the nodes it owns (and their
  spawned instances), and the nodes it shares a `messages` channel with
  ([workflow format](./workflow-format.md)). A spawned instance has its
  template's owner and channels, both ways. Anything else is refused with the
  reason and the list of whom the node can reach. Only nodes with someone to
  write to get `send_message` and `read_inbox`, and their system prompt names
  them.
- **Notice, then pull:** a message lands in the recipient's inbox
  (`message.sent` in the run's events, masked like every event). A live session
  gets a one-line notice,
  `[ork] 1 unread message from docs. Call read_inbox to read them.`, sent with
  `Session.send` at its next step, mid-turn or not; a node that is not running
  gets the notice when its session starts. `read_inbox` returns the unread
  bodies, oldest first (`message.read`).
- **Owner questions:** a loop out of rounds asks the owner of its nodes while
  the owner's session is live ([scheduler](./scheduler.md#loops)). The owner
  gets the whole question pushed
  (`[ork] Question q1 for you, as the owner of fix: …`, with the options and the
  recommended one) and replies with `answer`. A wrong option or someone else's
  question is refused. When the owner's session ends first, the question goes to
  the human as a decision (`owner.unanswered`).
- **Priority:** the user's messages (`ork chat`) and answers are pushed in full;
  agent messages only as notices, so a busy session pays for a body only when it
  reads it.

## Decisions

The decision queue ([queue.ts](../packages/core/src/control/queue.ts)):

- `ask_user` calls, permission prompts, `human.gate` nodes and exhausted loops
  all become decision records in the store (`<run>-<n>`, the question masked
  like events), with `decision.opened` in the run's events, and the asking node
  waits.
- The **first answer wins**: the run's own terminal (when it has one, with the
  prompts below) races `ork decide` in any other terminal. The loser's prompt is
  withdrawn, and `decision.answered` records the answer and who gave it
  (`terminal` or `decide`).
- A permission prompt is a decision with the options `allow` and `deny`; its
  context is the tool's input (at most 400 characters).
- A gate's `timeout` + `default` withdraws the question (`decision.withdrawn`)
  and answers it by itself; so does a stopped run.
- A run with no terminal (`ork run --detach`) waits for `ork decide`. A run
  whose stdin is not a terminal but that is not detached (a pipe, CI) keeps the
  terminal channel's rule: tools denied, the recommended option taken.
- `ork decide` (in [cli.md](./cli.md#decisions-and-stopping)) lists the open
  decisions of live runs and answers them; the UI inbox (M2) reads the same
  table.

## Event store

Every run event, in SQLite at `~/.ork/state.db` with a JSONL copy per run; logs,
the system monitor, chats and replay are all views over it. See
[Event store](./event-store.md).

## Reaching a live run

`ork decide` and `ork stop` in another terminal
([control.ts](../packages/core/src/control/control.ts),
[ADR-024](../decisions/ADR-024-event-store.md)) write their answer or command to
the store; the run looks at the store every second, and at once when woken on
its socket.

- **The socket:** `~/.ork/sockets/<run>.sock`, one JSON message per line:
  `{"type":"wake"}` makes the run look at the store now;
  `{"type":"follow", "after": <seq>}` sends every stored event after `seq`, then
  each new one, until the run ends (`ork logs --follow` uses it). It is removed
  when the run ends; a stale one is replaced when a run with that id starts.
- **Without the socket** (it could not listen, or the run is gone) nothing is
  lost: the store has every answer, command and event.
- **Commands:** `stop` interrupts the run as Ctrl-C does (`run.command` in its
  events, then `run.finished` with `interrupted`). `ork chat` (M1d) adds
  messages.

## Chat

`ork chat <run> <node>` ([cli.md](./cli.md#decisions-and-stopping)) talks to a
leader or worker:

- **A live run:** the message is a command in the store (`message`, with the
  node and the body, masked), and the run is woken on its socket. The bus pushes
  it in full, `[ork] The user writes to you (ork chat): …`, into the node's live
  session at its next step, or into its next session if it is not running
  (`user.message` with `delivered: now` or `queued`). The node's replies are its
  events, streamed to the chat over the socket.
- **A finished run:** the node's last session is resumed in the folder it ran in
  (`session.started` records it, and the driver) with the message as the next
  turn; its events and `user.message` (`delivered: resumed`) are added to the
  run's record after `run.finished`. The UI chat panel (M2) does the same.
