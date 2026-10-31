# ADR-019 — On a loop re-entry, leaders resume and workers start fresh

- **Status:** Accepted; amended by
  [ADR-033](./ADR-033-session-resume-on-any-node.md)
- **Date:** 2026-10-30
- **Topic:** engine / sessions
- **RFC:** waived — the author chose among the options below directly

## Context

A bounded loop sends work back to a node it already ran (e.g. reviews request
changes from the builder). The node can continue its earlier session or start a
new one.

## Decision

A re-entered **`claude.leader` resumes its session** (`resume` on the runtime
port) with the new input as its next message. A re-entered **`claude.worker`
starts a fresh session** whose brief carries the input in a `## Round n`
section. A leader delegated to again resumes the same way. Built in M1c
([specs/scheduler.md](../specs/scheduler.md#loops)).

## Options considered

- **Leaders resume, workers fresh** — chosen.
- **Always fresh**: simpler and cheaper per session, but a leader loses its plan
  and its prompt cache, and rebuilds both every round.

## Rationale

Leaders are long-lived by design ([concepts](../specs/concepts.md)): their
context is the plan they are steering. Workers are meant to be clean, which also
keeps a reviewer from anchoring on its earlier verdict.

## Consequences

- The scheduler keeps each leader's session id between rounds.
- A resumed leader's context grows each round; `maxRounds` bounds it.
