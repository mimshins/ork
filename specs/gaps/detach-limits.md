# Limits found fixing the detached start

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found fixing `ork run --detach` failing with `the run did not start in time`
when a local CLI stalled the start. What was built is in
[running and runs](../cli/running-and-runs.md) (`--detach`) and
[the scheduler](../scheduler.md) (reserves); what follows was left simpler.

- **L483 · A detached start longer than two minutes is killed.** The child
  touches `.ork/runs/<run>/starting` once a second until its run is recorded,
  and `detachRun` waits while the file is fresh, but never past a hard cap of
  120 seconds (`maxMs`); a child that gives no sign of life (it never beat, or
  stopped) for 15 seconds (`timeoutMs`) is killed too. A child that takes longer
  to record its run (a walk and driver checks each stalled on a slow local CLI,
  one after another), or that blocks its event loop so the beat stops, is killed
  with `the run did not start in time`; a caller may retry, so the child must
  not go on and start anyway. Every step before the record has its own timeout,
  so two minutes covers a realistic stall. Recording the run before the walk
  would remove the cap; it would change the store and `ork ps`, so it was left
  out.

How the heartbeat works, for whoever changes it:

- The child beats with `writeFileSync(file, "")`, which relies on `O_TRUNC`
  updating the mtime on Linux and macOS; errors are swallowed, since a throw in
  a timer would crash the child.
- The deadline is `min(spawn + maxMs, max(spawn, mtime) + timeoutMs)`. The `max`
  ignores a stale `starting` file left by an earlier start of the same run.
- `beginDetachedHeartbeat(env)` (in `remote/detach.ts`, to avoid an import cycle
  with `heartbeat.ts`) starts the beat only when `ORK_DETACHED=1` and
  `ORK_HEARTBEAT_FILE` is set, and deletes the variable so nodes and nested runs
  never touch the parent's file.
- Callers whose child never beats (`watch`, `watch/start`, `feedback-apply`)
  keep the flat 15 seconds.
- `specs/cli/running-and-runs.md` is at the 280-line docs limit, so more detail
  there needs a hub split first.
- In the nodes, `budgetWaitable` is a sync hook sharing one predicate with
  `budgetFreed`; the node releases its dollars only when a wait can happen, so
  there is no `reserveBudget(0)` window.
