# A node once per item of a list

Ork's `feature` workflow built the engine half of `forEach`, running a node once
per item of a list: schema, expressions, compiler, scheduler, replay, worktrees,
the workflow walker and the CLI (13 tasks of an accepted RFC), in Ork's own
repository. Run `f4e5e533` on 2026-11-08, Ork 1.0.0-alpha.6, with Claude Code as
the agent (CLI driver). The run committed and pushed the change itself, through
its own `publish` step, as
[`ed453d6`](https://github.com/mimshins/ork/commit/ed453d6): 128 files, +8,360 /
−951.

## At a glance

|                             |                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Status                      | succeeded                                                                           |
| Cost                        | **$20.07** (the workflow's cap was $35)                                             |
| Ork working time            | **60.7 min**                                                                        |
| Waiting on the maintainer   | 1 min                                                                               |
| Wall time                   | 61.7 min                                                                            |
| Claude sessions             | 15 (0 failed), 397 turns                                                            |
| Tokens                      | 54,241,079: 660 input, 415,451 output, 52,663,523 cache read, 1,161,445 cache write |
| Questions to the maintainer | 2, of them 0 permission requests                                                    |

## By node

| Node        | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| ----------- | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| spec        | claude-sonnet-5-5 |        1 | $0.29 |        15,295 |    233,739 |      28,955 |
| implement   | claude-sonnet-5-5 |        5 | $6.05 |       123,346 | 34,884,935 |     331,840 |
| engine-2    | claude-opus-5-5   |        1 | $1.07 |        19,751 |    710,970 |      66,004 |
| engine-3    | claude-opus-5-5   |        1 | $1.69 |        27,568 |  1,669,154 |     100,161 |
| implement-2 | claude-sonnet-5-5 |        1 | $1.06 |        23,592 |  4,030,870 |     106,403 |
| engine      | claude-opus-5-5   |        3 | $8.19 |       170,320 | 10,097,658 |     345,292 |
| build       | claude-sonnet-5-5 |        1 | $0.44 |        16,369 |    561,480 |      53,862 |
| review      | claude-opus-5-5   |        1 | $1.06 |        16,801 |    261,651 |      83,803 |
| docs        | claude-sonnet-5-5 |        1 | $0.23 |         2,409 |    213,066 |      45,125 |

## How it ran

- The largest change so far, and the first run whose leader sent builders in
  waves of one call each.
- Builders were running for 50.3 minutes: 20.8 with one at a time, 23.1 with two
  and 5.2 with three.

## What went wrong

- Nothing failed, and no permission was asked.
- **`maxWorkers: 3` ran out in wave 2.** It counts every worker a leader spawns
  over its life, so later tasks went to the two declared builders. The cap was
  raised afterwards.
- **The review was partial.** It passed in one round but said its budget ran out
  before it read everything; a separate review of the commit followed.

## Against a manual session

The change is 8,065 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$36.50**
($23.87–$54.97) and take **112 working minutes** (70–292).

Ork cost 45% less than the manual median, outside the manual range, and its
working time was 60.7 minutes against 112.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `c3306ee`).
