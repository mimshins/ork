# ADR-077 — Set a session's cap aside from the run's budget as it starts

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** scheduler, budgets
- **RFC:** waived — the maintainer decided this directly after build run
  `d67e4060`

## Context

A run's `limits.budgetUsd` counted only what sessions had reported, and the CLI
driver reports a session's cost when it ends. A running session counted as
nothing, so each session that started was offered all that finished sessions had
left. Build run `d67e4060` had about $9 of $35 left when two `engine` sessions
started side by side; each was given $8. Its leader's own session ran for 100
minutes and counted only at the end. The run ended `budget_exhausted` at $36.66,
and could have reached about $43. This was gap L216.

## Decision

A Claude node's session sets its cap (its `--max-budget-usd`) aside from the
run's budget in the same step that reads what is left, and lets it go when the
session ends; a node's reserve is dropped when it settles, whatever ended it
([reserves.ts](../packages/core/src/run/reserves.ts)). What the next session is
offered is the budget less what was spent and every reserve. A reserve never
ends a run: `budget_exhausted` still means spent. A node with nothing left waits
for another node's reserve to free, but only a worker's: a leader's session
waits on its children, so a child waiting on it would deadlock. With no worker's
reserve to wait on, the node does not start, as before.

## Options considered

- **Split what is left evenly among sessions starting together.** Softer on
  parallel builders, but a session starting later can still take the whole
  remainder, and the leader's own session stays uncounted.
- **Leave L216 open** for the gaps review, with this run as evidence.

## Consequences

- A run passes its budget by at most the turns that cross each session's cap.
- Sessions starting beside others get smaller caps, and near the end of a budget
  they may wait. A node with no `budgetUsd` of its own, and no
  `defaults.budgetUsd`, sets aside all that is left while it runs.
- A fork that answers for a leader and a `workflow.call` do not reserve yet
  (L216, L53).
- A resumed run starts with no reserves.
