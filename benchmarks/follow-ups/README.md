# Follow-ups: what a change leaves for later

Ork's `build` workflow added follow-ups to Ork, in Ork's own repository.
Follow-ups are work a change leaves for later, for an agent, a project, the
maintainer or another person. They come with a `follow_up` tool for sessions,
`ork follow-ups`, a panel in `ork ui`, a store chosen per project (Ork's store,
a file, or GitHub issues), and new steps in `build` itself. Run `c93e5bd3` on
2026-11-12, Ork 1.0.0-alpha.14, with Claude Code as the agent (CLI driver). The
run committed and pushed the change itself, through its own `publish` step, as
[`dedea75`](https://github.com/mimshins/ork/commit/dedea75): 137 files, +10,996
/ −194.

## At a glance

|                             |                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Status                      | succeeded                                                                               |
| Cost                        | **$34.26** (the workflow's cap was $50)                                                 |
| Ork working time            | **97.7 min**                                                                            |
| Waiting on the maintainer   | 2.3 min                                                                                 |
| Wall time                   | 100 min                                                                                 |
| Claude sessions             | 28 (3 failed), 875 turns                                                                |
| Tokens                      | 165,600,887: 1,342 input, 589,184 output, 163,359,954 cache read, 1,650,407 cache write |
| Questions to the maintainer | 6, of them 2 permission requests                                                        |

## By node

| Node      | Model             | Sessions |   Cost | Output tokens |  Cache read | Cache write |
| --------- | ----------------- | -------: | -----: | ------------: | ----------: | ----------: |
| engine    | claude-opus-5-5   |        4 |  $9.00 |       129,796 |  21,619,623 |     260,343 |
| implement | claude-sonnet-5-5 |        8 | $19.17 |       346,158 | 128,350,425 |     716,967 |
| design    | claude-sonnet-5-5 |        2 |  $1.32 |        36,742 |   3,477,674 |     150,520 |
| a11y      | claude-sonnet-5-5 |        1 |  $0.39 |         6,298 |     707,558 |      64,768 |
| build     | claude-sonnet-5-5 |        3 |  $0.66 |        20,010 |   1,554,077 |      76,115 |
| review.0  | claude-opus-5-5   |        3 |  $1.85 |        18,777 |   2,993,432 |     109,777 |
| review.1  | claude-sonnet-5-5 |        3 |  $0.96 |        15,335 |   2,637,014 |     135,915 |
| review.2  | claude-sonnet-5-5 |        3 |  $0.73 |        14,722 |   1,911,429 |      98,276 |
| docs      | claude-sonnet-5-5 |        1 |  $0.18 |         1,346 |     108,722 |      37,726 |

## How it ran

- **Building.** The leader ran for 81 minutes and handed the plan to its
  builders in waves:
  - `engine` built the core: the follow-up type and its store first, as the
    contract everything else used, then the stores and checks built on it.
  - `implement` built the rest: the plan template, the CLI and server, and
    `build`'s new steps.
  - `design` drew the UI panel before `implement` built it, and `a11y` audited
    the result.

  Two or three builders ran at once for most of the hour: engine and implement
  from minute 8, design and implement from minute 34, and a11y, design and
  implement from minute 71.

- **The engine's questions.** Engine stopped twice to ask the maintainer a
  design question the plan didn't settle: how Ork learns that a run published a
  PR, and which session gets a follow-up for a project with a live run. The
  maintainer answered both within a minute.
- **Review.** Three reviewers, one concern each (correctness, tests, repository
  rules), took three rounds:
  - Round 1 sent back six blocking findings. Follow-ups added by the `declare`
    step never got a PR reference, so their `after-merge` follow-ups never
    became due. The new `build` routing had no test. The watch spec and guide
    didn't mention the new follow-up check.
  - Round 2 passed correctness and tests. One finding remained: limits the
    leader found but hadn't entered in the gaps register.
  - Round 3 passed.
- **Most of the cost was one node.** `implement` cost $19.17 of $34.26. It ran 8
  sessions resumed one after another as a single conversation, so each round
  read the whole session again: 128M of the run's 163M cache-read tokens.

## What went wrong

- **Three sessions reached their turn limit:** engine (80 turns), implement (80)
  and design (40). Each time the leader sent the node back. The resumed session
  handed in its report, and engine took 3 turns to do it. Nothing was lost, but
  each one cost a round trip and a re-read of the whole session. Workflow: after
  this run, the leader was told to size each brief to about 40 turns of work,
  and Ork's gaps register records that a session at its limit hands in no report
  (G30).
- **Two permission requests,** both from the agent:
  - `a11y` ran `cd` into its checkout followed by `git diff`, which Claude Code
    asks about.
  - `design` read a file it had written to the system's temporary folder,
    outside its checkout.

  Both were allowed. Since a change earlier that day, the reviewers' prompt
  rules out both; the prompts of `a11y` and `design` don't yet.

## Against a manual session

The change is 11,190 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$50.64**
($33.12–$76.27) and take **155 working minutes** (98–405).

Ork cost 32% less than the manual median, inside the manual range, and its
working time was 97.7 minutes against 155.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `8bdbf29`).
