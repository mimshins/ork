# Limits found building budgets and quotas in tokens

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building RFC-015 part 2 (`budgetTokens`, `quotas.dayTokens`, the mixed-run
warnings and partial totals,
[ADR-084](../../decisions/ADR-084-budgets-and-quotas-in-tokens.md)). What was
left simpler:

- **L278 · A `workflow.call` passes no token budget to the run it calls.** A
  called run takes its caller's dollars as `--budget-cap`; there is no token
  twin, so the called run's own `limits.budgetTokens` is all that bounds its
  tokens, and the caller's `limits.budgetTokens` does not count them. Add a
  token cap beside `--budget-cap` and pass it from the call
  ([calls](../scheduler/calls.md)).
- **L279 · `run.started` does not record `budgetTokens`.** The run's token
  budget is not in the event, so a run read back (the Monitor's stat strip,
  `ork ps`) cannot show tokens against it, as it does dollars against
  `budgetUsd` ([L138](../ui/design-tokens-limits.md)). Record it in
  `run.started` and show it.
- **L280 · A session stopped at its token cap records $0.** Ork stops the
  process with SIGINT before it prints a result, and none of the three drivers
  prints a cost mid-session, so the session's ledger row and its share of the
  run's dollars are $0. A dollar limit on a run with such a session under-counts
  it. Estimating it needs the price table RFC-015 left out
  ([session ends](../runtime/session-ends.md#the-token-cap)).
- **L282 · `ork usage`'s tables show no partial mark per row.** A report's
  totals and each group carry `partial` and `tokens`, but only the header line
  prints `(partial)`; a group's cost in `--by` tables reads as plain dollars.
  Mark the row and show its tokens ([usage](../usage/tokens.md#partial-totals)).
- **L283 · The CLI says `(partial)` and the browser view says `≥`.** The same
  dollar total that leaves out an unpriced session is worded two ways. Pick one
  and use it in both ([usage](../usage/tokens.md#partial-totals)).
- **L284 · Two checks still read only `limits.budgetUsd`.** `loop.uncapped` (a
  loop with no `limits.budgetUsd` or `limits.timeout`) and `trigger.budget` (a
  watched workflow must have `limits.budgetUsd`) ignore `limits.budgetTokens`,
  so a workflow capped only in tokens still draws the loop warning and cannot be
  watched. Count either cap ([graph compiler](../graph-compiler.md),
  [watching](../scheduler/watching.md)).
- **L285 · A late or verify turn counts its own dollars twice against the run's
  budget.** The run's dollars left already include the activation's cost (its
  session reported on finishing), and the turn's limit subtracts it again, so a
  late turn is offered less than is left. The token twin is fixed. No test runs
  a resumed session's earlier legs under a token cap either
  ([session ends](../runtime/session-ends.md)).

Found fixing QA run c9c908b9's budget findings:

- **L326 · A running session's tokens show only once it ends.** No runtime event
  carries usage mid-session, so the ledger, `ork ps`, the view and the day quota
  see a session's tokens when it ends or is stopped; if Ork itself is killed, a
  running session's tokens are lost. A throttled `session.usage` event would fix
  both, and changes the runtime port: RFC first
  ([counted tokens](../usage/tokens.md#counted-tokens)).
- **L327 · A leader with no cap of its own sets aside the whole run budget.**
  Its reserve is never waited on and is held while it delegates
  ([ADR-077](../../decisions/ADR-077-reserve-session-caps.md)), so the nodes it
  owns are refused. The `budget.leader` warning makes the setup visible before a
  run; lending the reserve while it waits, as its slot is lent, would amend
  ADR-077 ([budget warnings](../usage/tokens.md#budget-warnings)).
- **L328 · A node's caps count one activation.** `budgetUsd`, `budgetTokens` and
  `maxTurns` restart on each activation, so `ork resume` gives a node its whole
  cap again; only the run's spend carries over. A cap per node per run would
  change workflow semantics
  ([where a token cap applies](../usage/tokens.md#where-a-token-cap-applies)).
- **L329 · Whether the run capped a session is decided at its first leg.** The
  run's remainder `startBudgets` returned decides it; a session capped by its
  own lower cap whose later legs are cut by the run's remainder (a sibling spent
  meanwhile) still ends as a node failure that edges route, not
  `budget_exhausted` ([budget](../scheduler.md#budget-and-concurrency)).
- **L330 · The run summary's `in` is a fourth meaning.** `ork usage`, `ork tree`
  and the UI now say prompt, out and counted, but a session's summary line still
  reads `100 in / 20 out (80 cached)`, its `in` being uncached input. Word it as
  the rest do
  ([on screen](../usage/tokens.md#prompt-output-and-counted-on-screen)).
- **L331 · Only an interrupted session keeps its usage.** A session stopped by
  `ork stop` or its cap keeps the tokens decoded so far; one whose driver
  crashed, or that a provider error ended without a result, still records zero
  usage, though the steps it ran were decoded
  ([session ends](../runtime/session-ends.md#the-token-cap)).
