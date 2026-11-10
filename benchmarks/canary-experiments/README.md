# A canary channel and experimental features

Ork's `feature` workflow added a canary release channel and experimental
features behind an opt-in to Ork itself, in Ork's own repository. Run `0427fb01`
on 2026-11-08, Ork 1.0.0-alpha.1, with Claude Code as the agent (CLI driver).
The run's last step refused the change over a clash with `main`, so the
maintainer applied it by hand as
[`742efac`](https://github.com/mimshins/ork/commit/742efac): 29 files, +928 /
−32.

## At a glance

|                             |                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------- |
| Status                      | failed                                                                          |
| Cost                        | **$5.94** (the workflow's cap was $35)                                          |
| Ork working time            | **29.4 min**                                                                    |
| Waiting on the maintainer   | 132.2 min                                                                       |
| Wall time                   | 161.6 min                                                                       |
| Claude sessions             | 11 (0 failed), 140 turns                                                        |
| Tokens                      | 5,777,860: 182 input, 106,067 output, 5,123,403 cache read, 548,208 cache write |
| Questions to the maintainer | 35, of them 33 permission requests                                              |

## By node

| Node      | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| --------- | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| spec      | claude-sonnet-5-5 |        1 | $0.27 |        11,036 |    191,258 |      34,977 |
| implement | claude-sonnet-5-5 |        3 | $0.48 |        11,574 |  1,128,375 |      63,224 |
| engine    | claude-opus-5-5   |        2 | $2.42 |        42,296 |  2,444,832 |     135,154 |
| build     | claude-sonnet-5-5 |        2 | $0.68 |        13,751 |    937,074 |     111,836 |
| review    | claude-opus-5-5   |        2 | $1.93 |        26,599 |    351,019 |     166,024 |
| docs      | claude-sonnet-5-5 |        1 | $0.16 |           811 |     70,845 |      36,993 |

## How it ran

- One of the first runs on the 1.0.0 alpha line, and the one that found the most
  Ork bugs.
- It spent over two hours of its wall time waiting for the maintainer: builders
  had no shell access yet and asked permission 33 times. Ork 1.0.0-alpha.2 gave
  them a shell.
- An earlier try of the same task on 1.0.0-alpha.0 failed at its first node
  after $2.04, because sessions loaded the machine's own MCP servers and broke
  Claude's prompt cache. 1.0.0-alpha.1 starts every session clean. That try is
  not in these numbers; with it the task cost $7.98.

## What went wrong

- **Three builder failures, all Ork bugs.** Two builders handed their leader's
  work at once collided on git's index lock (fixed in 1.0.0-alpha.2), and the
  leader removed a child's worktree too early (fixed in 1.0.0-alpha.3).
- **The final step refused the change.** An id it added to the gaps register had
  been taken on `main` meanwhile. The maintainer applied the change by hand;
  that work is not in these numbers.
- **33 permission requests** (the workflow's rules, since widened), which is why
  waiting time dwarfs working time.

## Against a manual session

The change is 960 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$4.34** ($2.84–$6.54)
and take **13 working minutes** (8–35).

Ork cost 37% more than the manual median, inside the manual range, and its
working time was 29.4 minutes against 13.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `9c0ee69`).
