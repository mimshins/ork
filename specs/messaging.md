# Messaging, decisions and logs

Status: **Partial**: `ask_user`, the permission prompt, `delegate` and
`spawn_worker` are built
([tools/](../packages/runtime-claude/src/tools/index.ts)), and so is the
[event store](./event-store.md); the message bus and decision queue are
specified for M1d.

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

**Decisions:**

- `ask_user` calls, permission prompts and `human.gate` nodes all become
  Decision records, and the asking node waits.
- Answer them in the CLI with `ork decide` (an interactive picker; the
  recommended option is preselected) or in the UI inbox.
- An optional `timeout` and `default` let unattended runs continue.

**Event store:** every run event, in SQLite at `~/.ork/state.db` with a JSONL
copy per run; logs, the system monitor, chats and replay are all views over it.
See [Event store](./event-store.md).

**Reaching a live run:** `ork decide`, `ork stop` and `ork chat` in another
terminal write their answer or command to the store, and the run watches for it;
a per-run local socket wakes the run at once
([ADR-024](../decisions/ADR-024-event-store.md)).

**Chat:** `ork chat <run> <node>` (or the UI chat panel) sends a user message to
a node's live session or resumes a finished one with `resume`.
