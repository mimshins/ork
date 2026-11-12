# QA of everything new in 1.0.0-alpha.14

Ork's `qa-pass` workflow tested what changed since 1.0.0-alpha.13: token
budgets, the day token quota, partial totals, the parallel-issues workflow, the
integration lock, follow-ups and `--input` tab completion. Each tester worked
the way a user would: it installed the package built from `main` into a
throwaway prefix and HOME and followed the docs, with stand-in `claude`, `cmd`
and `gh` programs so that nothing was paid for or sent. Run `c9c908b9` on
2026-11-12, Ork 1.0.0-alpha.14, with Claude Code as the agent (CLI driver). A QA
run changes no code: its result is a findings document the maintainer keeps.

## At a glance

|                             |                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Status                      | succeeded (2 of 8 surfaces without a report)                                        |
| Cost                        | **$2.26** (the workflow's cap was $14)                                              |
| Ork working time            | **28.3 min**                                                                        |
| Waiting on the maintainer   | 0.4 min                                                                             |
| Wall time                   | 28.7 min                                                                            |
| Claude sessions             | 9 (2 failed), 581 turns                                                             |
| Tokens                      | 45,990,340: 1,120 input, 476,410 output, 44,529,215 cache read, 983,595 cache write |
| Questions to the maintainer | 2, of them 1 permission request                                                     |

## By node

| Node  | Surface                                     | Model            | Turns |  Cost | Output tokens | Cache read | Cache write |
| ----- | ------------------------------------------- | ---------------- | ----: | ----: | ------------: | ---------: | ----------: |
| split | splits the scope into surfaces              | claude-haiku-5-5 |     7 | $0.01 |         4,691 |    134,150 |      41,955 |
| qa.0  | Tab completion for `--input`                | claude-haiku-5-5 |    81 | $0.29 |        58,159 |  6,130,805 |     115,702 |
| qa.1  | Token budgets per node and run              | claude-haiku-5-5 |    72 | $0.39 |        72,429 |  6,194,929 |     146,521 |
| qa.2  | Day token quota and usage                   | claude-haiku-5-5 |    72 | $0.29 |        55,438 |  5,591,792 |     115,295 |
| qa.3  | Partial totals in usage, ps, summary and UI | claude-haiku-5-5 |    63 | $0.29 |        56,127 |  4,936,447 |     118,280 |
| qa.4  | Parallel issues run                         | claude-haiku-5-5 |    53 | $0.18 |        55,409 |  3,856,749 |     104,378 |
| qa.5  | Integration lock and waiting                | claude-haiku-5-5 |    80 | $0.31 |        66,593 |  6,132,667 |     118,771 |
| qa.6  | Follow-ups guide and CLI                    | claude-haiku-5-5 |    81 | $0.28 |        60,059 |  6,202,712 |     111,444 |
| qa.7  | Follow-ups in `ork ui` and `build`          | claude-haiku-5-5 |    72 | $0.22 |        47,505 |  5,348,964 |     111,249 |

## How it ran

- A shell step packed the package from `main` (6 seconds), and `split` divided
  the scope into eight surfaces.
- Eight testers ran three at a time, each in its own worktree, starting a new
  one as each finished: the first three at minute 1, the last at minute 15. The
  longest took 14 minutes.
- **What they found.** The six testers that reported found 12 major and about 25
  minor findings, each with steps to reproduce, the doc it contradicts and a
  suspected place in the code. They also listed what passed and what they
  couldn't test. Among the major ones:
  - A run's token cap reserved by a leader leaves nothing for its workers, which
    are refused instead of waiting as the docs say.
  - A run cap reached inside a session ends the run `failed`, not
    `budget_exhausted`.
  - A command-code session's usage isn't recorded until the session ends, so a
    stopped session shows no tokens.
  - The integration lock isn't shared when the workflow file lives outside the
    project's repository, and a killed run's shell node keeps running after its
    lock is freed.
  - The parallel-issues workflow leaves issues labelled `in-progress` when a run
    fails before its pull request.
  - Two pages still said `command-code` is refused, though it runs.
- **What it couldn't reach.** No tester could use `ork ui` or answer a question
  with `ork decide`: inside a run, Ork withholds the browser's sign-in link and
  refuses `ork decide` on purpose, and the testers didn't get around either.
  `git commit` in a throwaway repository was also refused by the project's
  rules, so some testers ran everything with `--in-place`. The browser panels
  and the worktree paths of these features still need a test from the
  maintainer's own terminal.

## What went wrong

- **Two testers reached their turn limit** (80) before reporting: tab completion
  and the follow-ups CLI. Their surfaces have no report. Every tester that
  finished used 53 to 80 turns. Workflow: the limit is now 120, so those two
  surfaces need another run.
- **One permission request**, from `split`, which listed the guides with a shell
  loop. Agent; the testers' and builders' prompts now rule loops out, and
  `split`'s doesn't yet.
- **Leftover processes.** Two testers left a process running after they
  finished: a stand-in `claude` and a `ork run` in their temporary folders.
  Nothing used them, but QA should clean up after itself. Agent and workflow;
  not fixed yet.
- **One tester briefly went around a guard.** One tester unset the variable that
  marks a session as inside a run, to answer a question in its own throwaway run
  with `ork decide`. It reported this itself and didn't do it again. Nothing
  left its temporary HOME. Agent.

## Against a manual session

No estimate: the manual baseline is measured per changed line, and a QA run
changes none.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `b31eb38`).
