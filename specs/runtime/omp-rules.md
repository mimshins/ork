# Rules, the guard and the hold

_Part of [The `omp` driver](./omp.md)._

## What holds a node to its rules

The node is deny by default ([ADR-094](../../decisions/ADR-094-yolo-runs.md) for
`--yolo`), with two fences and no sandbox: `omp` has none for its file tools (a
`write` outside the checkout succeeded, measured).

- **`--tools` and the overlay's approvals** (`ompTools`,
  [omp-config.ts](../../packages/runtime/src/adapters/omp-config.ts)) are per
  tool and come from one function, so they cannot disagree. A built-in is
  offered when `plan` mode does not exclude it (`edit`, `write`, `bash`), no
  `deny` rule refuses every call of it (a bare rule, or a specifier Ork does not
  read), `tools.only` is unset or names it, and it is a read tool, or an `allow`
  rule names it, or the run is `--yolo`. A path-scoped `Read`, `Grep` or `Glob`
  deny covers all three read tools, so none is offered and the node reads
  through `extract`, which applies the patterns in Ork's process: this holds
  `readDenies: true`. Under `reading: extract`, `Grep` and `Glob` are withheld
  ([extract](./extract-tool.md#withheld-tools)). With nothing left the list is
  `read`, denied by the overlay and the guard (an empty `--tools` was not
  measured). MCP tools are not hidden by `--tools` (measured), hence the
  per-tool approvals.
- **The guard** is the node's rules per call: `guard.mjs`, a default export that
  registers a `tool_call` handler, with the matcher shared with `command-code`'s
  mod and Codex's hook
  ([tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts)).
  It sees `{ type, toolName, toolCallId, input }` and refuses with
  `{ block: true, reason }`; the model reads the reason. For each call, inside a
  `try`, in this order:
  1. Map the name: a built-in by table, `mcp__ork_session_ork_<tool>` to
     `mcp__ork__<tool>`; **any other name is refused, `--yolo` included**.
  2. Once the `stopped` marker exists, refuse everything.
  3. Refuse an address with a scheme and a path in Ork's private folder; refuse
     an `edit` or `write` whose real path is outside the worktree, or that names
     no path the guard can read, **`--yolo` included**. A `read`, `grep` or
     `glob` outside the worktree needs a rule.
  4. `decide`: the node's `deny`, `only` and `allow` rules and the reading rule,
     with the words used on `command-code`. A shell line is checked command by
     command ([command-code](../architecture/command-code.md)). Under
     `reading: extract` a shell read is refused with the `extract` call to make;
     under `extract-only` so is a `read` of a text file (an image or a PDF
     passes); `open` applies none ([extract](./extract-tool.md)).
  5. Ask Ork's hold endpoint, when the session has one
     ([pausing](#pausing-and-heavy-slots)).

  An `Edit` rule covers `edit` and `write`; a `Read` rule covers `read`, `grep`
  and `glob`. **Any error in the guard refuses the call.**

- **What the handler sees** (measured): `write {path, content}`; `read {path}`,
  where the path may carry a selector suffix (`a.txt:1-1`), a URL or an internal
  address (`xd://x`); `edit {input}`, one string that begins with a
  `[PATH#HASH]` header line, so the path is read from that header (the guard
  refuses an edit it cannot read a path from); `grep {pattern, path}`;
  `glob {path}` where `path` is a glob pattern, whose folders before the first
  wildcard the guard checks; `bash {command}`. A call the approval policy denies
  emits no `tool_call`, so the guard never sees it; one the guard blocks emits
  no `tool_result`.

## Pausing and `heavy` slots

`omp` has a hold, as `claude-code` has (ADR-041,
[run control](../run-control.md)): `ompAdapter.hold` makes the session runner
serve `/hold` beside `/mcp`, on the same local server and token, when the
session has a hold port (a run's session), and the wiring gets
`endpoint.holdUrl`. A session with no hold port sends no hold request and takes
no `heavy` slot.

- **The request.** After step 4, the guard sends `POST <holdUrl>` with the
  bearer token and `{ hook_event_name: "PreToolUse", tool_name, tool_input }`
  (the tool in Ork's words: `Bash`; the input as `omp` gave it), over
  `node:http` with no timeout of its own, and waits. Ork's own tools are asked
  too, so a paused leader does not delegate. A call the rules refuse is refused
  at once and never asked.
- **The answers** (`ompHoldAnswer`): `go` is `{}` and the call runs; `defer` is
  the `HELD` record and the guard refuses the call; a failed request, a status
  other than 200 or an answer the guard does not know refuses it too ("Ork could
  not be asked"). The guard fails closed: only exactly `{}` is go, and an
  unknown tool name is refused (`ompToolName` returns `undefined`).
- **A long pause.** `omp` cannot leave a call pending across processes and the
  runner's deferred resume would send the spec's prompt as a new message, so
  there is no true deferral. At the window's end (`OMP_HOLD_WINDOW_MS`, 60
  minutes) the endpoint answers `defer` and the guard refuses with "Ork paused
  this node, so this call did not run. Make the same call again; it waits until
  the node continues. Do nothing else." The model asks again, waits another
  window, and runs once the node continues: one leg, no resume. Each window a
  pause outlasts costs one model request with a cold cache, counted toward the
  node's budgets. A hold of 135 seconds, with a handler timeout of two hours,
  then ran and finished (measured); the whole 60 minutes is not measured.
- **The handler's timeout.** `omp` cuts a `tool_call` handler after
  `extensionHandlers.toolCallTimeoutMs`, so the overlay sets
  `2 × OMP_HOLD_WINDOW_MS + 60 000`: one window for a pause and one for a
  `heavy` slot. `omp`'s timeout only backs up an Ork that never answers.
- **`heavy` slots.** The same request takes the slot (`heavy.before` runs for a
  `Bash` call after the pause check, within the same window); a slot that does
  not come in time is the `defer` answer, and the repeated call keeps waiting
  for the same slot. The guard frees it **at once** with a `PostToolUse` request
  from its `tool_result` handler, which `omp` fires after a call that ran
  (including one that returned `isError`). It is sent only for `Bash` calls: the
  hook frees one slot whatever the tool, so a `Read`'s after-call must not free
  a running `Bash`'s slot. A call refused first fires none, so the session's
  next call and its end are the backstop
  ([machine](../machine.md#a-sessions-bash-call)). Two calls of one message are
  asked one at a time and end in either order, so the request is keyed by
  `toolCallId`.
- **A stop while a call is held.** The wiring listens on the session's abort
  signal and writes `stopped` before the hold's answer goes out; the guard
  checks the marker after the answer and before any later call, so the held call
  does not run. `omp` exited 130 within about a second on one SIGINT and the
  command did not run (measured); the node ends `interrupted`.
- **What Ork sees meanwhile:** nothing. The lines are silent while a call is
  held: `tool_execution_start`, and the assistant `message_end` of the request
  that made the call, with its usage, arrive only after the guard answers, so
  the token cap and `contextTokens` see that request late, and a leg stopped
  while a call is held does not count it (its aborted message has zero usage).
  The run records `node.held` and `node.released` as for any driver.
