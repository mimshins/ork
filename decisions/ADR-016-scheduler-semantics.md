# ADR-016 — How a workflow runs: activations, edges, dead paths and loops

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / scheduler
- **RFC:** waived — the author chose among the options below directly

## Context

A workflow mixes n8n-style flow edges, conditional edges, joins, routers and
bounded loops ([workflow format](../specs/workflow-format.md)). The scheduler
needed one set of rules for when a node runs, which edges fire, how a join knows
it has everything, and what happens when a loop runs out.

## Decision

1. **Activations.** A node runs once per activation; any taken incoming edge
   activates it, except a `control.join`, which waits by its mode.
2. **Edges without `when:` fire on success only** (a report whose status is not
   `fail`, exit code 0, control nodes, answered gates). Failures flow only along
   an explicit `when:` (e.g. `status == 'fail'`); a failed node that takes no
   edge fails the run.
3. **Dead-path elimination.** A node whose incoming non-loop edges all resolved
   as not taken is skipped and its outgoing edges are not taken, so joins never
   wait forever. Loop (`maxRounds`) edges never carry a skip.
4. **Bounded loops escalate.** A loop edge is taken at most `maxRounds` times
   per run; then the run asks the human (stop, one more round, or onward). A
   child that fails or runs out inside `delegate` goes to its leader in the
   report instead (ADR-017); telling a live owner about a loop needs the message
   bus (M1d).

Detail: [specs/scheduler.md](../specs/scheduler.md); code:
[scheduler.ts](../packages/core/src/run/scheduler.ts),
[routing.ts](../packages/core/src/run/routing.ts).

## Options considered

- **Edges without `when:` always fire.** Easier to write; failures then flow
  silently into the next node.
- **Fire on success only** — chosen.
- **Joins that wait for every input regardless.** Simple, but a join behind a
  router or a conditional edge would wait forever.
- **Dead-path elimination along the loop-free part of the graph** — chosen.

## Rationale

Failing loudly is the safer default for agent work, and an explicit
`when: status == 'fail'` edge documents the recovery path in the file. Removing
the `maxRounds` edges leaves a DAG (the compiler guarantees it), which makes
dead paths well-defined even with loops.

## Consequences

- Authors learn one rule: an unconditional edge means "on success".
- A branch can be skipped in one round and run in a later one; the run's events
  show both.
- The event stream (`node.skipped`, `edge.taken`, `loop.exhausted`) is the
  record M1d persists.
