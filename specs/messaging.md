# Messaging, decisions and logs

Status: **Partial**: `ask_user`, the permission prompt, `delegate` and
`spawn_worker` are built
([tools/](../packages/runtime-claude/src/tools/index.ts)), and so are the
[event store](./event-store.md), the decision queue, `ork decide`, `ork stop`
and the run's socket ([control/](../packages/core/src/control/index.ts),
[tests](../packages/core/test/control.test.ts)); the message bus is specified
for M1d.

**Ork MCP tools.** One registry
([tools/index.ts](../packages/runtime-claude/src/tools/index.ts)), one file per
tool, binds the tools each session gets; both drivers serve what it binds. A
node's report is its structured output, not a tool
([runtime](./runtime.md#the-node-report)). Built tools are marked ✓:

- `send_message(to, body)`
- `read_inbox()`
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

**Message bus:**

- Lives in-process in `core/`.
- Addressing is checked against the ownership tree plus the `messages` edges.
- A message reaching a busy session is queued, with a priority gate: user
  messages and decision answers first. It is injected between turns through
  `Session.send`.

**Decisions** ([queue.ts](../packages/core/src/control/queue.ts)):

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

**Event store:** every run event, in SQLite at `~/.ork/state.db` with a JSONL
copy per run; logs, the system monitor, chats and replay are all views over it.
See [Event store](./event-store.md).

**Reaching a live run** ([control.ts](../packages/core/src/control/control.ts),
[ADR-024](../decisions/ADR-024-event-store.md)): `ork decide` and `ork stop` in
another terminal write their answer or command to the store; the run looks at
the store every second, and at once when woken on its socket.

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

**Chat:** `ork chat <run> <node>` (or the UI chat panel) sends a user message to
a node's live session or resumes a finished one with `resume`.
