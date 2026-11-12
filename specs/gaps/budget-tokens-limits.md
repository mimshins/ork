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
