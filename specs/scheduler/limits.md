# Limits: running, resuming and stopping

_Part of [Scheduler: running a workflow](../scheduler.md)._

How a run is [scheduled](../scheduler.md), resumed and
[stopped](../run-control.md) for now, by choice. Those the gaps review carried
are open work in the [register](../gaps.md#limits).

- **L2 · A resumed run's budget counts what it spent.** Raise `limits.budgetUsd`
  (or `limits.budgetTokens`) to resume a run that ran out.
  ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L3 · Resume keeps finished results as they were.** The workflow file is read
  again, but a finished node keeps its result even if its definition changed,
  and new worktrees branch from the project's current `HEAD`.
  ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L4 · A run of one node is not resumed.** `ork run --node` runs again
  instead. ([ADR-026](../../decisions/ADR-026-resume-by-replay.md))
- **L6 · `delegate` blocks the leader.** There is no asynchronous form, and on
  the claude-code driver one call can stay open for at most 24 hours.
  ([ADR-017](../../decisions/ADR-017-blocking-delegate.md))
- **L29 · Managed settings can turn off the claude-code driver's pause.** A
  pause holds a `claude -p` session in a `PreToolUse` HTTP hook; where managed
  settings allow only managed hooks or other hook URLs, the hook never fires,
  and the node pauses only at its next activation.
  ([run control](../run-control.md#limits))
- **L30 · A single-node run takes only `stop`.** `ork run <wf> --node <id>` is
  not paused or continued, and has no node of its own to stop: `ork pause`,
  `ork continue` and `ork stop --node` refuse a `node-…` run with "stop the
  whole run instead". ([run control](../run-control.md#limits))
- **L31 · Stopping a leader leaves its running children running.** Its delegated
  children follow the owner-failure path and finish their work; only the leader
  is interrupted. ([run control](../run-control.md#stopping-one-node))
- **L39 · Concurrency is per run.** `limits.concurrency` does not add up across
  runs, so three runs at the default can hold 12 Claude sessions. Spending does,
  through [quotas](../usage.md#limits-across-runs).
  ([scheduler](../scheduler.md#budget-and-concurrency))
- **L41 · A retry has no delay.** A failed node can loop back with `maxRounds`,
  but it runs again at once, with no delay or backoff.
  ([scheduler](../scheduler.md#loops))
- **L43 · Nothing limits runs of one workflow.** Starting a workflow twice runs
  it twice, with no queueing and no cancelling of the older run, as other
  engines' concurrency groups do.
  ([scheduler](../scheduler.md#budget-and-concurrency))
- **L44 · Results are reused only within a resumed run.** No step cache spans
  runs. An agent's output varies, so one may never be worth having.
  ([resuming](./resuming-and-events.md#resuming-a-run))
- **L45 · A resumed run's clocks start again.** Time already worked is not
  counted, so a resumed run gets its whole `limits.timeout` again.
  ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L46 · A node left behind may still spend.** An executor that has not ended
  10 seconds after a timeout is abandoned, and a session's cost from then on is
  unknown to the run. ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L47 · A tool can outlive Ork.** Tools run in their own process groups, so a
  second Ctrl-C within 2 seconds, or Ork being killed, leaves one running. A
  program that starts its own session escapes a stop altogether.
  ([ADR-043](../../decisions/ADR-043-timeouts.md))
- **L166 · A process id reused within a second can pass for a run's.** Off Linux
  the start is read to the second, so a same-user process given a crashed run's
  id that second still reads as the run's. A start that can't be read falls back
  to the id alone. ([event store](../event-store.md#runs-and-events))
- **L172 · A join can fire twice around a loop out of rounds.** A source with
  two loop edges, one of them out of rounds and waiting on the person's answer
  (`loop.exhausted`), is no longer active, and a loop edge doesn't count as a
  way to run again, so an `all` join downstream of the other loop's branch reads
  that branch as not taken and fires. If the person then picks "again", the
  branch runs, reaches the join, and it fires a second time.
  ([scheduler](../scheduler.md#activations))
