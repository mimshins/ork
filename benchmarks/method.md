# How the benchmarks are measured

The numbers come from scripts in [`tools/benchmark/`](../tools/benchmark/), not
from anyone's reading of a run, and every one is in each benchmark's
`summary.json`.

## A run

A benchmark is one Ork run and every run it called (a `start` run with the
`plan` and `build` runs it started counts as one). The scripts read a copy of
Ork's local store, `~/.ork/state.db`: the runs, their events, the questions they
asked, and one usage row per Claude session.

- **Cost** is the sum of each session's cost as Claude Code reports it, at API
  list prices. These runs used a Claude subscription, so this is what the same
  work would cost on the API, not what was paid.
- **Tokens** are each session's own: input, output, prompt-cache reads and
  prompt-cache writes.
- **Working time** counts only minutes when at least one of the run's nodes was
  working: not a human gate, not a node waiting on a question or permission
  prompt of its own, not a leader waiting on a child that is waiting, and not a
  call waiting on the run it started. **Waiting time** is the rest of the wall
  time, almost all of it the maintainer away from a question. Both are reported,
  with **wall time** beside them.
- **The Ork version** is the one the runs recorded when they started or resumed.
  Runs from before Ork recorded it ran from source, so their version is
  `packages/cli/package.json` at the commit they started from, which
  `summary.json` names.
- **The change** is the commit the run produced. When the maintainer committed
  it by hand, because the run stopped at its last step or didn't commit, the
  benchmark says so.

## The manual baseline

What would the same change cost in a plain Claude Code session, with no Ork?
Running every feature twice would double the cost, so the baseline is estimated
from the history of this repository instead.

- **The data:** the transcripts of the plain Claude Code sessions in which this
  repository was developed by hand, on the same machine with the usual setup
  (project instructions, MCP servers, memory and subagents). Each is split into
  push windows: from one `git push` to the next.
- **Each window** gives a cost (the session's messages at API prices, fitted to
  the totals Claude Code recorded) and working minutes (from each prompt to the
  session's last event before the next), against the lines its pushed commits
  changed. Lock files, generated files and changelogs don't count.
- **The rate** is the cost and minutes per 1,000 changed lines, as quartiles
  weighted by lines. The middle half of the windows sits between p25 and p75.
- **Each benchmark's estimate** applies that rate to the lines its own commit
  changed.

Only the aggregates are published (`results.json`'s `manual_rate`): counts and
quartiles, never a session, a window or a date.

## Caveats

- **Lines are a weak measure of work.** A rename is cheap per line, a subtle
  engine fix is dear, so the manual range is wide.
- **The manual side includes planning.** Its windows hold design talk and
  planning as well as building, so it is likely a little high; an Ork run's plan
  was written before it started.
- **Time is not one to one.** A manual session does one thing at a time, and
  counts a wait on a permission prompt inside a turn; Ork's builders run in
  parallel, and its waits are left out.
- **Quality is not scored.** Every Ork run has an independent review that can
  send the work back; the manual commits passed the same pre-push checks, with
  no separate review.
- **Few runs, one codebase, one maintainer.** These are early alpha runs on Ork
  itself. They show where Ork's costs come from, not what every project will
  see.

## The suite's cost

What `vitest run` over the whole repository costs in CPU, before and after the
change that made the suite cheaper and let a passed check be skipped
([check once](../specs/check-once.md),
[ADR-082](../decisions/ADR-082-check-once-keyed-by-files.md)). CPU is user plus
system time of the process and its children (`/usr/bin/time`), not wall time:
wall time depends on how many cores are free.

Measured on a 12-core laptop that was **loaded** with other work, so every
number is higher than an idle machine would give and the wall times are noisy.

### The whole suite

| What ran                                     | CPU-s | User | System | Wall |
| -------------------------------------------- | ----: | ---: | -----: | ---: |
| Before: default workers (11)                 |   571 |  478 |     93 | 59 s |
| Default workers, with the other changes      |   502 |      |        |      |
| 4 workers alone                              |   314 |      |        |      |
| 3 workers alone                              |   318 |      |        |      |
| After: a third of the cores (4), all changes |   303 |  254 |     49 | 71 s |

More workers than a third of the cores spent more CPU for the same tests (the
cores are shared and caches are cold), so the cap is now always a third, in a
run or not. Wall time went up a little; the CPU, and so the heat and the room
left for other runs, went down by about 47%.

### Files that changed most

| Files                                                     | Before | After |
| --------------------------------------------------------- | -----: | ----: |
| `packages/cli` tests (compile cache, shared fixtures)     |  156 s | 114 s |
| `packages/core/test/timeouts.test.ts` (fake timers)       |  9.9 s | 0.3 s |
| `packages/core/test/watch.test.ts` (fake timers)          |  9.7 s | 0.3 s |
| `packages/core/test/walk-fuzz.test.ts` (100 runs locally) |  7.6 s | 1.4 s |

### Not measured

- **The idle target.** The plan's target was under 200 CPU-s on an idle machine,
  from about 330. Nothing here was measured idle.
- **A build measured again.** The plan's other check, a build like run
  `f9d00e18` measured again (full checks per run, CPU per tool command), needs a
  real build run, and has not been done. The figures that motivated the change
  (about 1.6 CPU-hours of checks in that build) are not repeated here.

Both are in the [gaps register](../specs/gaps/check-once-limits.md) (L269).
