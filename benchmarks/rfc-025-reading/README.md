# Reading rule A/B: `reading: open` against `reading: extract`

An A/B benchmark of
[RFC-025](../../rfcs/archived/RFC-025-extract-only-reading.md)'s reading rule,
from 2026-11-17 to 2026-11-18. Each arm made the same two changes twice with
Ork's `build` workflow on Claude Code: 8 runs in all, with Sonnet throughout.
The runs used Ork at
[`ac864764`](https://github.com/mimshins/ork/commit/ac864764), which was
released unchanged as 1.0.0-alpha.24; their events record 1.0.0-alpha.23, the
version in its `package.json`. Nothing was kept: every run was discarded at its
publish gate.

**Verdict: inconclusive.** The arms overlap. Sessions already read mostly
through `extract` with `reading: open`, so enforcing it had little left to cut.
Neither arm cost more.

## The arms

Both arms offer the [`extract` tool](../../specs/runtime/extract-tool.md),
loaded from the first turn, and both carry the harness line that asks for it.
The arms differ only in what RFC-025 added:

|                                                                               | `reading: open` | `reading: extract` (the default)           |
| ----------------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| A shell line that starts by reading files (`cat`, `grep`, `sed`, `git diff`…) | runs            | refused, naming the `extract` call to make |
| Grep and Glob                                                                 | offered         | withheld unless the node names them        |
| A read-only node's `git diff`, `log`, `show`                                  | allowed         | refused (only `git status`)                |
| A Read of a text file in a node that can't edit                               | allowed         | refused                                    |

## The tasks

Each run redid a change that had already landed, from that change's parent
commit, with a plan written once from its commit message and used for all 4 of
its runs:

1. **Task 1:** [`db865ef8`](https://github.com/mimshins/ork/commit/db865ef8),
   project-relative paths in `ork onboard`'s uncommitted-files note: one
   function, its tests, a spec, a gap entry. The base was `b62713b9`.
2. **Task 2:** [`d8dac4aa`](https://github.com/mimshins/ork/commit/d8dac4aa),
   following a called run again when a resumed caller brings it back: one engine
   function, its test, a spec. The base was `d372930d`.

Every run answered the gates the same way: it deferred all follow-ups, ratified
the decisions and discarded the change. The arms alternated (open, extract,
open, extract), one run at a time. The project and workflow files are this
repository's own at each base commit. Their `build` workflow names Grep and Glob
for one node, so those two tools were not withheld from that node.

## At a glance

Medians of 2 runs per task and arm. The reading weight is the
[carried weight](../method.md#carried-weight) (characters times later turns) of
shell reads, searches, git reads, Read and `extract`, for the nodes that write
(implement) and the reviewers (review).

| Task | Arm     | Cost  | Working min | Median turns | Reading weight: implement / review / all |
| ---- | ------- | ----- | ----------- | ------------ | ---------------------------------------- |
| 1    | open    | $0.82 | 2.9         | 3.3          | 195k / 98k / 310k                        |
| 1    | extract | $0.80 | 2.8         | 4            | 206k / 114k / 342k                       |
| 2    | open    | $1.15 | 5.8         | 5.5          | 296k / 564k / 874k                       |
| 2    | extract | $0.97 | 4.4         | 4.8          | 209k / 265k / 501k                       |

Every run:

| Task | Arm     | Run        | Cost  | Sessions | Median turns | Reading weight: implement / review / all | `extract` / shell reads / Read calls | Refused |
| ---- | ------- | ---------- | ----- | -------- | ------------ | ---------------------------------------- | ------------------------------------ | ------- |
| 1    | open    | `155b7cfa` | $0.85 | 6        | 3            | 183k / 93k / 293k                        | 13 / 5 / 1                           | 0       |
| 1    | open    | `40fb2c9d` | $0.80 | 6        | 3.5          | 207k / 103k / 327k                       | 16 / 2 / 1                           | 0       |
| 1    | extract | `a9d8262b` | $0.82 | 6        | 4            | 255k / 117k / 388k                       | 17 / 2 / 2                           | 2       |
| 1    | extract | `749ea7e3` | $0.78 | 6        | 4            | 156k / 111k / 295k                       | 15 / 0 / 2                           | 0       |
| 2    | open    | `e40e9126` | $1.30 | 10       | 6.5          | 281k / 883k / 1,184k                     | 32 / 0 / 0                           | 0       |
| 2    | open    | `a7479e07` | $0.99 | 6        | 4.5          | 312k / 244k / 563k                       | 17 / 4 / 2                           | 0       |
| 2    | extract | `25c1f618` | $1.01 | 6        | 4.5          | 215k / 308k / 534k                       | 20 / 2 / 0                           | 2       |
| 2    | extract | `ea58f8f0` | $0.93 | 6        | 5            | 204k / 222k / 468k                       | 20 / 0 / 2                           | 1       |

All 8 runs succeeded and passed `pnpm check`, and every change touched the same
function as the commit it redid. One run (`e40e9126`) went through a second
round: its correctness reviewer asked for a change, which explains its 10
sessions and most of task 2's open-arm weight.

## Against the pass mark

The plan set the pass mark before the runs. It needed, per task:

- **At least 15% less reading weight with `extract`,** for both implement and
  review. Task 1 failed: +5% and +16%. Task 2 passed on the medians, -29% and
  -53%, but the open arm's median includes the review round. Against its other
  run alone, review weight was 9% higher with `extract`.
- **No rise in median cost.** Both tasks passed: -2% and -16%.
- **No rise of more than 10% in median turns.** Task 1 failed (+21%, 3.3 to 4).
  Task 2 passed (-13%).

The runs overlap in every measure. Task 1's total reading weight was 293k–327k
open and 295k–388k with `extract`; task 2's was 563k–1,184k against 468k–534k.
With 2 runs an arm, that is noise, not a result.

## What the sessions did

`extract` was already the main way to read in both arms:

- **Open:** 78 `extract` calls, 11 shell reads and 4 Reads.
- **Extract:** 72 `extract` calls, 4 shell reads and 6 Reads.

`extract` carried 82–100% of each run's reading weight in both arms. Three
earlier builds of this repository, on earlier versions of Ork, put 34%, 51% and
65% of their weight through it. The 6 Reads in the extract arm were writers
reading a file before an edit, which Claude Code requires and the rule allows.

Ork refused 5 calls in the extract arm:

- two `git diff` lines from the docs node;
- a shell `grep` from a writer;
- a shell read from a reviewer;
- a reviewer's Read of a text file.

No refusal ended a session, and every run passed its checks.

RFC-023's reading of a result like this: high adoption with no cut means the
weight left is `extract`'s own output. Enforcement removes the few shell reads
left, at no cost that shows, but it is not where the weight is.

## What went wrong

- **A run built on the wrong base.** Ork's fault: the first attempt took the
  project's `git.base` (`main`), which in a fresh clone already held the change.
  We stopped it, $1.23.
- **The old schema refused the rule.** A setup error: committing `reading: open`
  to a base that predates RFC-025 failed that base's own tests, $0.27. The rule
  was then left uncommitted in the checkout, where Ork reads it.
- **Gates answered by hand.** One run's gates were answered from outside the
  benchmark: follow-ups taken, publish to `main`. The publish failed, because
  the clones had no remote. That run was not counted and was rerun, $1.20.
- **Small sample.** 2 runs per task and arm cannot separate arms this close. A
  firmer answer needs more runs and larger tasks.

All runs together cost $10.19, $2.70 of it on the three runs not counted.

## Files

The numbers come from `pnpm benchmark` for each run and `pnpm benchmark:arms`,
which joins them (see [method](../method.md#carried-weight)). The per-run
folders are not published here, because none of the runs produced a commit to
compare against a manual session.
