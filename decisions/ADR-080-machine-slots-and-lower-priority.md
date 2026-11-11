# ADR-080 — Heavy commands take a machine-wide slot, and runs start at a lower priority

- **Status:** Accepted
- **Date:** 2026-11-11
- **Topic:** scheduler, runtime port, event store, project rules
- **RFC:** waived — the maintainer decided this directly in discussion on
  2026-11-11 (plan "Smooth runs"), after measuring a build run

## Context

With runs going, a 12-core laptop got hot and loud. One `pnpm check` keeps about
10 cores busy for 33 s, 97% of it in `vitest`. A build run of about an hour ran
the whole suite about 25 times, 9 from Ork's own `verify:` and 16 that agents
ran although their prompt said Ork checks. Builders run four at once, so up to
four suites shared the cores, and a busy machine made tests flaky. Several runs
at once multiplied it. A sentence in a prompt had already been ignored.

## Decision

- **Heavy commands are a project rule.** `heavy` in `project.yaml` lists the
  full-suite commands, in the permission patterns' syntax. A Claude node with
  `verify:` has them denied in its session (Ork runs that check); targeted tests
  stay allowed.
- **A machine-wide slot for each heavy command.** A ledger in `~/.ork/slots`
  allows `ORK_HEAVY_SLOTS` (default 2) at once, across runs and projects, first
  come, first served; the rest wait. A record whose process is gone is swept and
  its slot taken over. Ork's tool commands take a slot around the command; the
  node's, its owners' and the run's clocks stand still while it waits, as for a
  decision. A wait is never silent: `slot.waiting` names the holders and
  `slot.taken` ends it.
- **Lower priority by default.** `priority: low` (the default) starts sessions
  and tool commands below the `ork` process: `os.setPriority`, and on macOS
  utility QoS. `normal` turns it off. `ork` itself stays normal.
- **CPU is recorded.** A tool command's CPU time (user and system, children
  included) rides on its `tool.result`; a `tool_cpu` table (store migration 19)
  keeps it beside the usage ledger, so `ork usage --by node` and the benchmark
  show it.
- **Quick wins beside it.** Builders verify with `pnpm check:changed`, vitest
  caps its workers at half the cores inside a run, and the overview stream no
  longer reads every event of every running run each second.

## Options considered

- **A sentence in the prompt only.** Already ignored by agents.
- **A limit on Ork's own check nodes only.** Agents' own test runs would stay
  unlimited.
- **A machine-wide limit through the OS (a semaphore, `flock`).** Not portable,
  and a wait could not be an event the user sees.
- **No limit.** The machine keeps thrashing.

## Rationale

The slot is the only mechanism that bounds the load whoever starts the command.
It reuses the lease ledger's idea (a hard link made atomically, a pid swept when
dead), so it adds no dependency. Lower priority by default costs a slower check
only when the machine is busy with something else, which is the point, and one
line turns it off.

## Consequences

- A check can wait for another run's, up to the length of a suite; the wait is
  shown in `ork ps`, `ork logs`, `ork tree` and the Now column of `ork ui`.
- A project must list its heavy commands; with none, nothing is denied and no
  slot is taken.
- `~/.ork/slots` holds run ids, node ids and pids only.
- The store gains a table and a migration; a `tool.result` gains an optional
  `cpu`. Older runs are filled in by the migration.
- Not covered, tracked in the [gaps register](../specs/gaps.md): sessions' own
  CPU, only Claude Code taking slots for a session's Bash calls (L257), CPU on
  Windows, no `ork doctor` sweep of the slot ledger (L259), priority set just
  after the spawn, a re-measured build.

Spec: [machine](../specs/machine.md).
