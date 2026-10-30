# Messaging, decisions and logs

Status: **Partial**: `ask_user` and the permission prompt reach a human channel
today ([tools.ts](../packages/runtime-claude/src/tools.ts)); the message bus,
decision queue and event store are specified for M1d.

**Ork MCP tools injected into every Claude node** (`ask_user` and, for the CLI
driver, `permission` are built; a node's report is its structured output, see
[runtime](./runtime.md#the-node-report)):

- `send_message(to, body)`
- `read_inbox()`
- `delegate(child, brief)`: leaders only.
- `spawn_worker(template, brief)`: leaders only, capped.
- `ask_user(question, options[], recommended, context)`
- `claim(resource)` and `release(resource)`
- `feedback(kind, target, title, body, severity, evidence[])`: capped per
  session; see [Feedback and self-improvement](./feedback.md).
- `permission`: CLI driver only.

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

**Event store:**

- Append-only events (`node.started`, `msg.sent`, `tool.called`, `usage`,
  `decision.opened`, …) in SQLite at `~/.ork/state.db`.
- A JSONL copy for each run, at `.ork/runs/<runId>/events.jsonl`. The `runs/`
  directory is gitignored.
- Logs, the system monitor, chats and replay are all views over this stream.

**Chat:** `ork chat <run> <node>` (or the UI chat panel) sends a user message to
a node's live session or resumes a finished one with `resume`.
