# Output, usage, budgets and the doctor

_Part of [The `omp` driver](./omp.md)._

## Output, usage and ends

[omp-events.ts](../../packages/runtime/src/adapters/omp-events.ts) reads one
JSON object a line, with no result line (the exit ends the leg):

- `session` gives `session.started` (`id`; a fork's `parentSession` starts the
  session under the new id). An assistant `message_end` gives one
  `assistant.text` from its `text` blocks (`thinking` and `toolCall` blocks give
  none); a `user` or `toolResult` message gives nothing. `tool_execution_start`
  gives `tool.called` (`toolCallId`, the name in Ork's words, `args`);
  `tool_execution_end` gives `tool.result` with `isError`, and
  `fault: "arguments"` for an Ork tool's bad-arguments answer. A refused call is
  a `tool.result` with `isError` and the guard's reason. Calls pair by
  `toolCallId`, in any order.
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
- **Ends.** Exit 0 after `agent_end`: the report Ork's `report` tool accepted
  decides it, else `no_report`. Exit 3 is `budget_limit`, with the `cost-gate`
  notice's words as the detail (after `agent_end`, or, on a leg already over the
  cap, after `session`, `advisor_cost_changed` and the notice alone). Exit 130
  is `interrupted`. Exit 1 before a turn (no login, an unknown model or session,
  Ork's server not ready, a guard that did not load, a missing overlay) gives no
  event, so the runner reads stderr and the provider classifier names the kind
  (`No default model selected` is `auth`; `Model "<x>" not found` is
  `model_unavailable`), else `driver_crashed`; a request's `stopReason` other
  than `toolUse` and `stop` is kept as the end's detail. There is no turn limit.
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
- A hold longer than 135 seconds; whether `omp` holds for the whole 60 minutes.
- Whether a model makes the same call again when the pause refusal asks it to.
- Whether `--max-cost` on a fork counts the source's spend (assumed yes).
- What an empty `--tools` does to MCP tools.
