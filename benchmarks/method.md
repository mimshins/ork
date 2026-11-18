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

## Carried weight

A tool result stays in a session's conversation and every later turn reads it
again, which is most of the input tokens. The carried weight is a proxy for it,
in `carried.json` from `pnpm benchmark`, or alone from
`pnpm benchmark:carried <run>`
([RFC-023](../rfcs/archived/RFC-023-extract-tool-for-session-reads.md)).

- **The proxy:** a tool result weighs its characters times the turns after the
  one that made it (a turn is one assistant message). A 1,000-character result
  on turn 2 of 5 weighs 3,000.
- **The report:** weight and share by role (the node without its `-2` instance
  suffix or `.1` fan-out suffix) and by kind of call, turns per session (mean,
  median), and calls to `extract` with the characters they returned (from each
  result's footer), and each role's calls of each kind with how many Ork refused
  (RFC-025: an error result that starts "Ork refuses"). Kinds: reads through the
  shell (`cat`, `sed`, `head`, `tail`, `nl`, `less`, `bat`, `awk`), searches
  (`rg`, `grep`, `find`, `ls`, `fd`, `tree`, Grep, Glob),
  `git diff`/`show`/`log`, tests and checks, Read, Ork's tools, `extract`,
  other.
- **Arms:** `pnpm benchmark:arms <folder> <name>…` sets benchmarks named
  `<prefix>-<task>-<arm>-<n>` side by side: per run, cost, working minutes,
  median turns, the weight of the reading kinds (shell reads, searches, git
  reads, Read, `extract`) for the writing roles, the review roles and in all,
  and the calls of `extract`, shell reads and Read with the refusals; then each
  task and arm's medians.
- **The baseline:** this script on the RFC's four build runs (`f7f49775`,
  `8d0a6287`, `3867d943`, `aedbdc3d`): 55 sessions; shell reads 57%, searches
  17%, the Read tool 9% and git reads 9% make 92%. That is the weight an extract
  tool could reach, not what it saves: what it returns is carried too. Turns per
  session by run: mean 17–34, median 13–28. The RFC's hand count (88 sessions,
  87%, mean 97 and median 66 turns) counted a resumed session once per start and
  each content block of a message as a turn; compare against these figures.
- **Heuristic kinds:** a shell command is named by its first real command
  (leading `cd`, `export` and assignments skipped; a pipeline by its first
  command). A compound one can land in the wrong kind; that moves weight between
  kinds, never the total.
- **Left out:** subagent transcripts, forks, drivers other than `claude-code`,
  and sessions whose transcript is not on the machine (counted by role as
  `missing_transcripts`; with none found, no file is written).
- **A proxy, not a cost:** it ignores cache read and write prices, the model and
  output. Compare runs of the same work with it, beside cost.
- **Private:** only names of roles and kinds and numbers are written; no path,
  command, file name or result text.

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

### The UI project, before and after sharing the DOM

`vitest run --project ui` (112 files, 1,953 tests), on the same 12-core laptop
with 4 workers, lightly loaded (other work running, load about 4 to 10). Wall is
`real`; CPU is user plus system from `/usr/bin/time -l`. The split is Vitest's
own (`Duration` line), a share of the wall time.

| What ran                                              | Wall                   |      CPU-s | Tests | Import | Environment |
| ----------------------------------------------------- | ---------------------- | ---------: | ----: | -----: | ----------: |
| Before: every file in its own module graph and window | 35.0 s, 35.6 s         |   151, 162 |   48% |    26% |         25% |
| After: `isolate: false` for the UI project            | 14.7 s, 15.1 s, 14.7 s | 49, 51, 49 |   49% |     3% |         48% |

Wall time fell by about 58% and CPU by about 68%. The time spent inside the
tests (the sum of their own durations) fell only 14%, from 59 s to 51 s: the
saving is the import each file paid again (React, dockview and the app, about a
quarter of the wall time before). The jsdom environment still starts per file.
The slowest file is `panels/followups-panel.test.tsx` at 4.6 s before and 4.8 s
after; no UI file is near 15 s.

What `isolate: false` needs, and what was tried:

- No UI test mocks a module, so a shared module graph is safe; a file's DOM,
  stubbed globals (`unstubGlobals: true` undoes them after each test) and timers
  are the state that can reach the next file. Two files showed races under
  shuffle (one of them also without sharing): `feedback-arrival` cancels the
  frame it asked for and lets Open run's frame pass before moving the focus;
  `worktrees-dialogs` waits for the focus to land on Cancel. Their assertions
  are unchanged.
- The UI project passed 8 runs in a row with `--sequence.shuffle`, and 4
  without.
- `--pool=threads` measured the same as forks (14.4 s); `vmThreads` fails 5
  Builder tests, so the pool stays as it was.
- Not changed, for no measured gain or no need: the Node project (no file is
  over 15 s alone; the slowest, `packages/nodes/test/issues-example.test.ts`,
  took 14.6 s in a loaded full run) and `packages/cli/test/once.test.ts`
  (copying one repository per test instead of `git init` saved about 4% of its
  CPU, 8.4 s against 8.8 s, so it stays as it was). The `issues` example's world
  is copied from one template per worker: that file's CPU fell from 8.8 s to 7.6
  s (about 14%).

The Node project's before numbers, on the same day: 313 files, 4,845 tests, 74 s
wall, 258 CPU-s (tests 83%, import 15%).

### A build measured again

Ork's checks in three build runs, from the CPU each tool command records (user
plus system, children included); agents' own Bash runs record no CPU, so they
are counted, at about what each check costs:

| Build run                     | Ork's checks | Agents' own checks            |     Total |
| ----------------------------- | -----------: | ----------------------------- | --------: |
| `f9d00e18` (before)           |      7,439 s | 11 × `check:changed` (~350 s) | ~11,300 s |
| `a02a8077` (before)           |      5,826 s | 16 × `check:changed` (~350 s) | ~11,400 s |
| `7df12f48` (after, 268 files) |      2,326 s | 25 × `check:fast` (~13 s)     |  ~2,650 s |

About 75% less, on the largest change of the three. Three things did it: agents
in checked nodes run `check:fast` and leave the suites to Ork, a full check
costs about 280 CPU-s in a run instead of about 600, and the publish hit the
cache (1 CPU-s), since the same files had passed. `f9d00e18`'s Ork figure
includes three failed publish attempts.

### Not measured

- **The idle target.** The plan's target was under 200 CPU-s on an idle machine,
  from about 330. Nothing here was measured idle; it is in the
  [gaps register](../specs/gaps/check-once-limits.md) (L269).
