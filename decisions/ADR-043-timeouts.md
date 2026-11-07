# ADR-043 — Timeouts measure work, and an expired node is an ordinary failure

- **Status:** Accepted
- **Date:** 2026-11-03
- **Topic:** engine / workflow format / run control
- **RFC:** waived. The author chose these options over the others below, after a
  comparison with other workflow engines.
- **Builds on:** [ADR-041](./ADR-041-pause-continue-stop.md) (a timer that
  counts only while a node is not held)

## Context

Only `human.gate` had a timeout. A stuck command or session could hold a run
forever, and [RFC-004](../rfcs/archived/RFC-004-workflows-calling-workflows.md)
adds nodes that wait on whole runs, which would inherit the problem.

Checking this showed something worse: aborting a tool sent SIGTERM to one
process and moved on. A program that ignored it, and anything a program had
started, kept running after the node had failed. `ork stop` had the same fault.

## Decision

1. **`timeout` on tool nodes, on `claude.leader` and `claude.worker` (and
   agents), in `defaults`, and in `limits` for the whole run.** It is written
   `30s`, `15m`, `2h`. A workflow that sets none has none.
2. **The clock measures work.** It stands still while the node waits on the
   user: a pause, an open question, a permission prompt. An owner's clock stands
   still when a node it owns is waiting too, and a run's when anything in it is.
3. **An expired node fails like any other.** Its output keeps what it had and
   adds `status: fail`, a summary and `timedOut: true`, so `when: timedOut` can
   handle it. With no edge taken, the run fails as usual.
4. **An expired run ends `timed_out`**, a status of its own beside
   `budget_exhausted`. `ork resume` continues its cut-off sessions, as after a
   stop.
5. **A timeout cannot be held up.** An executor that has not ended 10 seconds
   after its abort is left behind, and the run goes on.
6. **A tool runs in its own process group.** Aborting it sends the group
   SIGTERM, then SIGKILL after 2 seconds. This serves `ork stop` and Ctrl-C too.

A gate's `timeout` keeps its meaning: its `default` answers. It is not replaced.

## Options considered

- **The default:** none unless set (chosen: existing workflows behave as
  before); a default on tool nodes (could fail long builds that work today, with
  a number chosen without data); defaults everywhere (the same, for sessions
  too).
- **The clock:** pausing while waiting on the user (chosen: a question left
  overnight says nothing about the work); always wall-clock (simple, but a late
  answer fails a node that was fine).
- **An expired run's status:** `timed_out` (chosen: the user and a caller can
  tell it from a stop); reusing `interrupted` (no change for the status's
  readers, but it would say the user stopped a run they did not).
- **Stopping a tool:** a process group (chosen: it reaches what the program
  started); signalling only the program (what Ork did, which leaves children
  running).

## Rationale

A timeout exists to answer "is this stuck?". Time spent waiting on a person
cannot answer that, and failing a node for it would teach people to set timeouts
so long they mean nothing. Treating expiry as a normal failure means edges,
loops, reports and resume need nothing new.

## Consequences

- A resumed run's clocks start again ([L45](../specs/gaps/limits-running.md)).
- A session left behind after the grace may still spend, and its cost is unknown
  to the run ([L46](../specs/gaps/limits-running.md)).
- A tool in its own group does not get a terminal's Ctrl-C directly, so Ork
  passes the stop on. A second Ctrl-C during the 2 seconds, or a crash of Ork
  itself, leaves the tool running ([L47](../specs/gaps/limits-running.md)).
- Timeouts are checked by tests and on real tools. On a real Claude session they
  use the same interrupt as `ork stop`, and have not been run on one.
