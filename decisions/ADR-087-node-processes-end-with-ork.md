# ADR-087 — A node's processes end with `ork`

- **Status:** Accepted
- **Date:** 2026-11-12
- **Topic:** engine, process lifetime, machine ledger, locks and slots
- **RFC:** waived: the maintainer decided it directly on 2026-11-12, weighing
  the options below; the plan "Integration-lock fixes from QA run c9c908b9"
- **Amends:** [ADR-043](./ADR-043-timeouts.md) §6 (a tool's process group is
  also ended when `ork` itself dies)

## Context

The QA pass on 1.0.0-alpha.14 SIGKILLed an `ork run` and found its node's
processes still running after the lock that run held had been swept and handed
to a waiter. Work could then run outside the lock.

Tool nodes already run in their own process group
([ADR-043](./ADR-043-timeouts.md) §6, `detached: true`), and that is why they
survive: killing `ork` does not reach the group. The group is killed only on
abort, and abort never runs when `ork` dies by SIGKILL, the OOM killer or a
crash exit. (`ork run` handles SIGINT, SIGTERM and SIGHUP.) Agent sessions run
in `ork`'s own group and are ended only by a live `ork`. The ledger record of a
lock or a heavy-check slot holds the `ork run` pid, and the sweep and
`ork doctor` test only that pid, so a record is taken over while its node still
runs.

## Decision

**A node's processes end with `ork`.** This covers tool programs and agent
sessions, and by the same path the heavy-check slots.

- Each tool program and each session starts in its own process group, beside a
  small `sh` watcher that holds a pipe from `ork`.
- When `ork` dies by any cause, including SIGKILL, the pipe reads EOF. The
  watcher sends its group SIGTERM, then SIGKILL after 2 seconds
  (`KILL_AFTER_MS`, as in ADR-043 §6).
- When a node ends normally, the wrapper stops the watcher first, so background
  processes a node leaves behind behave as they do today.
- A session starts as `sh -c '<watch> & exec "$0" "$@"'`, so its pid, and the
  SIGINT that stops it, stay Claude's own.
- A session now runs with `detached: true`, so a terminal Ctrl-C no longer
  reaches it directly. `ork`'s own SIGINT handler (`run.ts`) must stop it.
- The watcher's text lives in one core helper, `orphan-guard.ts`, used by
  `nodes` (`spawn.ts`) and `runtime` (`session-leg.ts`). The runtime port and
  the ledger record do not change.

## Options considered

- **A. The holder is alive while its node's process group is.** The record lists
  the process groups running under it, and the sweep and `ork doctor` drop it
  only when the pid and every group are gone. It closes the window below, but it
  changes the runtime port (executors report their groups), rewrites the record
  during a hold, and changes the ledger format. Waiters wait for the orphan to
  end on its own.
- **B. The sweeper kills the orphan groups it finds, then takes the lock.** It
  needs A's records and an identity check (a start time, as `process-age.ts`
  does) before it kills. One run kills another's processes, and a wrong identity
  kills an unrelated process. Not recommended.
- **C. Nodes die with `ork` (chosen).** It prevents the orphan rather than
  detecting it. The change stays in `spawn.ts`, `session-leg.ts` and a core
  helper, with no port or ledger change. It also covers the heavy-check slots,
  abandoned executors and a crash exit.
- **A + C.** No window, at the cost of A's port change.

## Consequences

- **A window of up to 2 seconds.** A waiter's sweep sees the dead pid within one
  poll (500 ms), while the orphan has up to 2 seconds of SIGTERM grace. A push
  in flight may land in that window. The shipped pushes are fast-forward only,
  so the next holder's push is rejected and nothing is lost. A workflow that
  force-pushes could lose work.
- **Escapes.** A program that calls `setsid` (a daemon) leaves the group, as
  [L47](../specs/scheduler/limits.md) already says. What Claude Code does with
  its own Bash children is unverified; the fake-driver test checks the group,
  and a real session is a follow-up.
- **Not on native Windows.** There is no `sh` and no POSIX process group there,
  so a killed `ork` may leave a node running. It would need Job Objects, which
  means a native dependency and its own ADR. Recorded as a gap; WSL 2 is the
  supported path.
- **A killed git step may leave `index.lock`** in the crashed run's own
  worktree. A resume re-runs the locked nodes from the first.
- A ledger record is still alive while its pid is, so a reused pid keeps a dead
  holder's lock. Recorded as a gap, not fixed here.

Spec: [scheduler](../specs/scheduler.md), [runtime](../specs/runtime.md),
[integration](../specs/integration.md). Builds on
[ADR-085](./ADR-085-lock-field-and-hold.md).
