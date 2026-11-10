# Letting a node choose its MCP servers

Ork's `feature` workflow let a Claude node name the MCP servers it loads, in
Ork's own repository. Run `16ca8153` on 2026-11-08, Ork 1.0.0-alpha.3, with
Claude Code as the agent (CLI driver). The run left the change in its worktree,
and the maintainer committed it as
[`0485790`](https://github.com/mimshins/ork/commit/0485790): 40 files, +1,074 /
−65.

## At a glance

|                             |                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------- |
| Status                      | succeeded                                                                       |
| Cost                        | **$5.79** (the workflow's cap was $35)                                          |
| Ork working time            | **28.7 min**                                                                    |
| Waiting on the maintainer   | 5.7 min                                                                         |
| Wall time                   | 34.3 min                                                                        |
| Claude sessions             | 9 (0 failed), 104 turns                                                         |
| Tokens                      | 6,256,787: 150 input, 114,628 output, 5,739,386 cache read, 402,623 cache write |
| Questions to the maintainer | 4, of them 2 permission requests                                                |

## By node

| Node   | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| ------ | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| spec   | claude-sonnet-5-5 |        1 | $0.44 |        15,241 |    621,771 |      56,546 |
| engine | claude-opus-5-5   |        2 | $3.59 |        68,996 |  4,032,307 |     175,332 |
| build  | claude-sonnet-5-5 |        2 | $0.25 |         6,304 |    144,345 |      43,070 |
| review | claude-opus-5-5   |        3 | $1.33 |        22,942 |    792,286 |      88,894 |
| docs   | claude-sonnet-5-5 |        1 | $0.18 |         1,145 |    148,677 |      38,781 |

## How it ran

- A small change through the full loop: spec, build, review, fix, docs.
- The review sent the first build back with four findings: one major (named
  servers never loaded through `ork run --node` or `ork chat`), one minor and
  two low. All four were fixed in the second round.

## What went wrong

- Nothing failed. The review node stopped twice to ask for shell access, which
  is 4.9 of the 5.7 minutes spent waiting on the maintainer.

## Against a manual session

The change is 1,115 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$5.05** ($3.30–$7.60)
and take **16 working minutes** (10–40).

Ork cost 15% more than the manual median, inside the manual range, and its
working time was 28.7 minutes against 16.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `7ffa69e`).
