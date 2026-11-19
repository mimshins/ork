# ADR-104 — A reserve never ends a run, and a worker waits instead of starting on a sliver

- **Status:** Accepted
- **Date:** 2026-11-19
- **Topic:** scheduler, budgets
- **RFC:** waived — the maintainer decided this directly after build run
  `9be5c519` (follow-ups `83f3af6d` and `a98e57bf`); the options are below
- **Amends:** [ADR-077](./ADR-077-reserve-session-caps.md) (a reserve never ends
  a run, now kept in two places; a node offered less than its own cap waits)

## Context

Build run `9be5c519`, capped at $20, ended `budget_exhausted` with $10.09 spent
and nothing in flight, saying "the run's budget of $20 is spent". A worker had
been offered $0.04: $20, less $9.96 spent, a leader's $4 reserve and a sibling's
$6 reserve. It hit that cap on its first request, `runCapsOf` blamed the run
because the offer was the run's remainder, and the scheduler stopped the run
with `stopsAs: budget_exhausted` though nothing was spent out. That broke
[ADR-077](./ADR-077-reserve-session-caps.md)'s rule that a reserve never ends a
run. On the same run another worker started with $0.04, spent $0.13 and failed.

## Decision

- **A node blames the run only when it is spent.** `ExecuteContext` gets an
  optional `budgetSpentIn(unit)`, true when the run's budget in `usd` or
  `tokens` is committed at or above its limit (reserves not counted).
  `limitWatch` reads it where it would blame the run, and sets the blame only
  when the hook does not answer `false`. A remainder shrunk by other nodes'
  reserves is then the node's own plain `budget_limit` failure, which an edge or
  a rule may route. A context without the hook behaves as before.
- **The scheduler checks again, as a backstop.** When a node's result carries
  `limited` and `stopsAs: budget_exhausted`, the scheduler reads
  `spend.spentOut()` after `spend.settled(id)` (before it, the node's cost would
  count twice). If the run is spent it stops `budget_exhausted`; if not, the
  result is recorded as a plain `budget_limit`, with no `limited` or `stopsAs`.
  A quota (`limited` with no `stopsAs`) and `stopsAs: failed` are unchanged.
- **A worker waits instead of starting on a sliver.** When a node has a cap of
  its own and is offered less than it, it holds nothing and waits for a reserve
  to free (`budgetFreed`), then reads again. If no worker's reserve is out, it
  starts with the true remainder. A leader's reserve is never waited on (as in
  [ADR-077](./ADR-077-reserve-session-caps.md): a leader waits on its children),
  and a node with no cap of its own never waits. The rule is shared by dollars
  and tokens.
- **The texts say what happened.** A refused start now reads "nothing is left to
  start with: the run's budget is spent or set aside by running sessions"
  (tokens likewise), since the budget may be set aside, not spent.

## Options considered

- **The scheduler alone.** The first answer: it would keep the run alive, but a
  node would still say "the run's budget is spent" when it was not, and the
  result would carry a blame that was false when produced.
- **Only the node hook.** Any executor that does not supply or read the hook
  would still stop an unspent run. The scheduler keeps the guard.
- **A worker starts on whatever is left.** What run `9be5c519` did: a $0.04
  session cannot finish a task and costs its overhead.

## Consequences

- A run ends `budget_exhausted` only when its budget is spent, in both units.
- Workers under a tight budget run one after another, behind a running worker's
  reserve, instead of failing on a sliver. Waiters hold nothing, so they never
  wait on each other.
- A driver that reports a session's cost late may read below budget; the node
  then fails as `budget_limit` and the run goes on until a later check finds it
  spent.
- A quota, not a reserve, may shrink an offer; the worker waits though no
  reserve is to blame, and starts when the reserve frees
  ([L463](../specs/gaps/budget-tokens-limits.md)).
- A fork that answers for a leader and a `workflow.call` still do not reserve
  (L216, L53).
