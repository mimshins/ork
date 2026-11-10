# Three engine bug fixes in parallel

Ork's `feature` workflow fixed three independent bugs in Ork's engine: leader
claims blocking children, `delegate`'s input errors, and `ork worktrees clean`'s
branch names, in Ork's own repository. Run `c2ebd09e` on 2026-11-08, Ork
1.0.0-alpha.5, with Claude Code as the agent (CLI driver). The run committed and
pushed the change itself, through its own `publish` step, as
[`6332204`](https://github.com/mimshins/ork/commit/6332204): 22 files, +693 /
−62.

## At a glance

|                             |                                                                                |
| --------------------------- | ------------------------------------------------------------------------------ |
| Status                      | succeeded                                                                      |
| Cost                        | **$4.30** (the workflow's cap was $35)                                         |
| Ork working time            | **23.8 min**                                                                   |
| Waiting on the maintainer   | 2.3 min                                                                        |
| Wall time                   | 26.1 min                                                                       |
| Claude sessions             | 10 (0 failed), 136 turns                                                       |
| Tokens                      | 3,427,575: 130 input, 89,249 output, 2,984,044 cache read, 354,152 cache write |
| Questions to the maintainer | 2, of them 0 permission requests                                               |

## By node

| Node      | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| --------- | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| spec      | claude-sonnet-5-5 |        1 | $0.35 |        13,561 |    218,886 |      47,885 |
| implement | claude-sonnet-5-5 |        2 | $0.20 |         4,494 |    415,654 |      29,306 |
| engine    | claude-opus-5-5   |        1 | $1.17 |        22,793 |    821,190 |      68,918 |
| engine-2  | claude-opus-5-5   |        1 | $1.20 |        24,993 |    836,115 |      66,515 |
| build     | claude-sonnet-5-5 |        2 | $0.26 |         5,375 |    274,989 |      45,096 |
| review    | claude-opus-5-5   |        2 | $1.02 |        16,840 |    333,467 |      77,447 |
| docs      | claude-sonnet-5-5 |        1 | $0.10 |         1,193 |     83,743 |      18,985 |

## How it ran

- The first run with parallel builders, and the first to push to `main` on its
  own.
- The leader split the three fixes across `engine`, `implement` and a spawned
  `engine-2`. The two engine builders ran one after the other instead of
  together, because the leader sent them in two blocking calls; run together
  they would have saved about 5 minutes. Ork now tells a leader to send a wave
  as one call.
- The review sent back one low finding (three docs still described the old
  behavior), fixed in round two.

## What went wrong

- Nothing failed, and no permission was asked.

## Against a manual session

The change is 755 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$3.42** ($2.23–$5.15)
and take **10 working minutes** (7–27).

Ork cost 26% more than the manual median, inside the manual range, and its
working time was 23.8 minutes against 10.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `a01b97e`).
