# Readable approval gates

Ork's `feature` workflow made human approval gates readable: Markdown, folding,
a document shown beside the question, and filters in the Decisions panel, in
Ork's own repository. Run `e59d99dc` on 2026-11-08, Ork 1.0.0-alpha.4, with
Claude Code as the agent (CLI driver). The run stopped at its last step, a
rebase conflict, and the maintainer finished the push by hand as
[`aa3b231`](https://github.com/mimshins/ork/commit/aa3b231): 89 files, +4,268 /
−317.

## At a glance

|                             |                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------- |
| Status                      | failed                                                                            |
| Cost                        | **$11.75** (the workflow's cap was $35)                                           |
| Ork working time            | **71 min**                                                                        |
| Waiting on the maintainer   | 4.3 min                                                                           |
| Wall time                   | 75.3 min                                                                          |
| Claude sessions             | 17 (1 failed), 279 turns                                                          |
| Tokens                      | 28,487,240: 480 input, 276,427 output, 27,302,305 cache read, 908,028 cache write |
| Questions to the maintainer | 16, of them 13 permission requests                                                |

## By node

| Node      | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| --------- | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| spec      | claude-sonnet-5-5 |        1 | $0.52 |        17,666 |    630,202 |      69,420 |
| implement | claude-sonnet-5-5 |        5 | $4.08 |       109,307 | 19,257,183 |     265,200 |
| design    | claude-sonnet-5-5 |        1 | $0.66 |        22,328 |    906,696 |      85,463 |
| engine    | claude-opus-5-5   |        3 | $3.52 |        64,425 |  3,488,243 |     191,902 |
| a11y      | claude-sonnet-5-5 |        2 | $0.57 |        14,633 |  1,359,955 |      72,412 |
| build     | claude-sonnet-5-5 |        2 | $0.51 |        14,871 |    895,624 |      66,901 |
| review    | claude-opus-5-5   |        2 | $1.72 |        31,882 |    652,357 |     118,349 |
| docs      | claude-sonnet-5-5 |        1 | $0.18 |         1,315 |    112,045 |      38,381 |

## How it ran

- A UI-heavy change with a design pass and an accessibility audit beside the
  builders.
- This run predates parallel waves: its leader sent eight tasks one at a time,
  so builders seldom overlapped. It is the sequential baseline for the runs
  after it.
- The review's first round returned five findings, all fixed in the second.

## What went wrong

- **`publish` stopped on a rebase conflict.** A commit pushed to `main` mid-run
  changed the same workflow lines. The step kept the commit and stopped, as
  designed; the maintainer resolved it by hand. Not an Ork bug.
- **One builder session hit its 80-turn limit** ($2.72, 11.6M of the run's
  cache-read tokens) without a report; the leader sent its work back to
  continue. It carried too much at once.
- **13 permission requests** from the accessibility node, for commands the
  workflow did not allow yet. Rules were added after this run.

## Against a manual session

The change is 4,294 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$19.43**
($12.71–$29.27) and take **60 working minutes** (38–155).

Ork cost 40% less than the manual median, outside the manual range, and its
working time was 71 minutes against 60.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `a33d570`).
