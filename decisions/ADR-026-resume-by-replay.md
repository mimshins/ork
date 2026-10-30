# ADR-026 — `ork resume` replays a run's recorded results

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / resume
- **RFC:** waived — the author chose to resume the whole run when the M1d task
  spec was clarified; the options are below

## Context

A run that was stopped, failed, ran out of budget or crashed had to start over,
paying again for every node that had already done its work. The event store
([ADR-024](./ADR-024-event-store.md)) keeps everything a run did, so the run can
be continued from it. The scheduler's state (outputs, rounds, which inputs a
join has, loop counts, leaders' sessions, worktrees) is not stored as such; only
events are.

## Decision

1. **Same run, same id.** `ork resume <run>` reopens the run's record and
   appends to its events; `ork logs` and `ork tree` read one continuous run.
2. **Replay, not reconstruction.** The scheduler runs the workflow again from
   its entries, and a `Replay` hands each flow activation the result its node
   recorded last time, in order, instead of running it
   ([resume.ts](../packages/core/src/run/resume.ts)). Routing, joins, routers
   and loop counts are rebuilt by the same code that built them the first time.
3. **What runs again:** a node's results are handed back up to its first one
   that failed or never finished; from there it runs. A result made anew marks
   its output, and any activation whose input carries one (directly or through a
   join) runs too, so nothing downstream keeps a result computed from an old
   input. Delegated runs belong to their leader and are never handed back.
4. **Recorded, so it starts the same way:** `run.started` now carries the run's
   inputs and its settings (`--in-place`, `--driver`); `--input` and the flags
   override them.
5. **Worktrees the run left** (not removed) are adopted; a node whose worktree
   was removed after its merge checks its branch out again.
6. **Loop answers** given last time (by the human or a live owner) answer the
   same question again, in order; other questions are asked anew.

## Options considered

- **Replay recorded results** (chosen): no second model of the scheduler's
  state, and a result is reused only when its input is the one it was made from.
- **Rebuild the scheduler's state from events** (queue, inbox, rounds): faster
  to start, but a second, drift-prone copy of the scheduler's logic.
- **Resume sessions only** (`ork chat` already does): cheap, but the run's flow,
  joins and loops would not continue.

## Consequences

- A resumed run's `limits.budgetUsd` counts what it spent before; raise it in
  the workflow to resume a run that ran out.
- The workflow file is read again: an edit since the run changes what runs. New
  worktrees branch from the project's current `HEAD`.
- A node that was cut off mid-session starts a new session (a leader's re-entry
  still resumes its previous round's session).
- A run of one node (`ork run --node`) is not resumed; it is run again.
