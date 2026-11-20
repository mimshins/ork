# Output, usage, budgets and the doctor

_Part of [The `omp` driver](./omp.md)._

## Output, usage and ends

The [`omp-rpc` codec](../../packages/runtime/src/adapters/omp-rpc.ts) reads one
JSON frame a line from `omp --mode rpc`. Frames with print mode's shapes go to
[omp-events.ts](../../packages/runtime/src/adapters/omp-events.ts), so the
events, usage and ledger below are unchanged; the codec reads the rest:

- **Handshake and responses.** `ready` (with `maxFrameBytes`, 1048576) opens the
  leg. Ork then writes `get_state` and `prompt` (a leg resumed after a deferral:
  the message that asks for the held call again; any other resume: the node's
  prompt); each request has an `id`, and the tool's `{"type":"response"}`
  carries it back, with `success: false` or an `error` failing that request. The
  `get_state` response's session id gives the `session.started` event (a
  print-mode `session` frame does too, once).
- **`steer`** is a message mid-turn and **`abort`** the interrupt; both are
  requests with a response.
- **Not events:** `extension_ui_request` of a method but `select` (`setWidget`,
  …) gets no event and no answer; a `select` is an
  [approval](./omp-rules.md#approvals-over-rpc).
- **A frame in chunks** (over `maxFrameBytes`) ends the leg failed, naming the
  limit; a line that is not JSON does too ([L497](../gaps/omp-limits.md)).
- **The wire names** the spike did not measure (`prompt`'s `message`, the
  `get_state` id, the cancel answer, how a chunk is marked) are
  [listed](#not-measured).

What the print-mode shapes give, as before:

- `session` gives `session.started` (`id`; a fork's `parentSession` starts the
  session under the new id). An assistant `message_end` gives one
  `assistant.text` from its `text` blocks (`thinking` and `toolCall` blocks give
  none); a `user` or `toolResult` message gives nothing. `tool_execution_start`
  gives `tool.called` (`toolCallId`, the name in Ork's words, `args`);
  `tool_execution_end` gives `tool.result` with `isError`, and
  `fault: "arguments"` for an Ork tool's bad-arguments answer. A refused call is
  a `tool.result` with `isError` and the guard's reason, and `fault: "refused"`
  when that text is the guard's own refusal
  (`Ork: <tool> is … Do not retry it.`, `Ork refuses …`;
  [refusal.ts](../../packages/runtime/src/tools/refusal.ts)): three of one tool
  in a node file a `tool.refused` item ([capture](../feedback/capture.md)).
  Calls pair by `toolCallId`, in any order.
- `message_start`, `message_update`, `tool_execution_update`, `turn_start`,
  `turn_end`, `agent_start`, `advisor_cost_changed` give no event, and the
  messages `turn_end` and `agent_end` repeat are not counted again.
- **Dropped:** `credentialId`, `responseId`, `thinkingSignature`, `details`
  (hold paths, a long shell trace), `intent`, `requestControls` and the thinking
  text. The model `omp` resolved is not recorded: `session.started` carries the
  model as written, or `default`.
- **Usage** per assistant `message_end`: `usage.input` (cache reads are not in
  it, measured), `output`, `cacheRead`, `cacheWrite`, `cost.total` and one turn,
  and the line carries the usage so far, so `budgetTokens` stops a running leg
  ([session ends](./session-ends.md#the-token-cap)). `contextTokens` is the last
  assistant message's `input + cacheRead + cacheWrite`; two legs keep the later
  leg's. Dollars are `omp`'s catalogue prices: a subscription login gets
  notional dollars and a model with no known price costs 0.
- **Ends.** A `prompt_result` only marks a turn (its `status`, and a
  `sessionSettled` that can be `false` with a wake to follow); the session ends
  at **`session_settled`**, read with the last `prompt_result`: `completed` is
  the print path's exit 0, so the report Ork's `report` tool accepted decides
  it, else `no_report`; an `error` with `code: "cost_cap"` is `budget_limit`,
  with the error's message as the detail; `aborted` is `interrupted`; any other
  error is a failed end with its message. The client then closes `omp`. The
  process exiting first (no login, an unknown model or session, Ork's server not
  ready, a guard that did not load, a missing overlay) gives no settled end, so
  the runner reads stderr and the provider classifier names the kind
  (`No default model selected` is `auth`; `Model "<x>" not found` is
  `model_unavailable`), else `driver_crashed`; a request's `stopReason` other
  than `toolUse` and `stop` is kept as the end's detail. A stop is `interrupted`
  with no report. There is no turn limit.
- **The report** goes by Ork's `report` tool (`reportSchema: false`)
  ([node report](./node-report.md)).

## Budgets

- **`budgetTokens`:** the runner stops the leg at the request that reaches it,
  `budget_limit`.
- **`budgetUsd`** is what one start may spend, as on the other drivers, but
  `--max-cost` counts the **whole session**. The wiring passes
  `--max-cost <S + budgetUsd>`, where `S` is what Ork's ledger says the session
  had spent: 0 for a new session, the session's for a resumed one, the source's
  for a fork. The value is the same on every leg of one start, so a message leg
  gets no second budget. A request in flight can pass the cap.
- **The ledger** is Ork's own count: the decoder adds each request's
  `cost.total` as it reads it, in `~/.ork/omp/spent/<session id>` (0600, in a
  0700 folder; never pruned), and a fork's own file starts from its source's.
  The decoder records that inherited spend only for a leg whose spec has
  `fork: true`, never from the `session` header: a resumed fork's header may
  still carry `parentSession`, and keying on it doubled the ledger on each
  resume. It can be below `omp`'s (a request cut before its line, a side request
  on no line), so the cap errs tight; a missing entry reads as 0.
- **A resumed leg reports the session's total** as its cost (the decoder starts
  from `S`), as `claude-code` does, which is what `ownSpend` expects
  ([usage](../usage.md#what-a-resumed-session-spent)). Two legs combine with
  `addUsage`.

## The doctor check

`omp --version`: missing is `skip`, with the hint to install it; older than
`MIN_OMP_VERSION` (18.22.2, the version the capture legs ran) is `warn`. Else
`omp models --json` runs and is parsed: one model or more is `ok`, "logged in (N
models)"; an empty list, a failing command or output that is not that JSON is a
warning, "sign in with `omp login`". Only the count is shown; Ork runs no other
`omp` command, never `omp auth`, `omp token` or `omp usage`, and reads no file
of the agent folder. `models --json` can take about 15 seconds in a fresh home
(measured), so the check may wait that long. While the descriptor is unproven
the status is `skip` whatever the output
([drivers](./which-driver.md#the-ready-driver)). A node's own model is not
checked before a run: a follow-up.

## Not measured

- The gate run: a paid, capped run on a real `omp` that flips `proven`. It must
  measure the hold (a pause mid-turn, a whole window, a pause past it, a stop
  while a call is held, a `heavy` slot taken and freed), a stop mid-turn with no
  hold, a failed model request's lines, usage on a second provider and on a
  subscription login, and what the user's own extensions, rules and MCP servers
  add to a session.
- Everything rpc: the gate run now also covers a `steer` during a call, an
  approval, a deferral and `--resume` after an `abort` with Ork's
  `--session-dir`, a cost cap over prompts, a chunked frame and the start-up
  time ([L497 to L502](../gaps/omp-limits.md)).
- The wire names above that the spike did not capture: `prompt`'s `message`
  field, `get_state`'s `data.sessionId`, the cancel answer's `cancelled: true`,
  an error's `message` and the chunk marker.
- A hold of the whole 9-minute window, and whether a model makes the held call
  again when the resume message asks it to.
- Whether `--max-cost` on a fork counts the source's spend (assumed yes).
- What an empty `--tools` does to MCP tools.
