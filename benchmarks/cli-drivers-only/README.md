# Agent CLIs as drivers: OpenCode and Command Code beside Claude Code

Ork's `start`, `plan` and `build` workflows took an accepted RFC (RFC-014) from
a one-line brief to a pushed change: the Agent SDK driver removed, the runtime
port and package renamed, a driver runner and contract suite, and OpenCode and
Command Code added as drivers next to Claude Code, in Ork's own repository. Runs
`aa51c078` (`start`), `86d5fe37` (`plan`) and `d67e4060` (`build`) on
2026-11-10, Ork 1.0.0-alpha.9, with Claude Code as the agent (CLI driver). The
`build` run committed and pushed the change itself, as
[`692df82`](https://github.com/mimshins/ork/commit/692df82): 238 files, +8,749 /
−2,534.

## At a glance

|                             |                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Status                      | `build` succeeded and pushed; `start` failed (see below)                                |
| Cost                        | **$50.32** (caps: `plan` $10, `build` $35, raised to $52 for one resume)                |
| Ork working time            | **150 min**                                                                             |
| Waiting on the maintainer   | 10.8 min                                                                                |
| Wall time                   | 160.8 min                                                                               |
| Claude sessions             | 40 (2 failed), 1,171 turns                                                              |
| Tokens                      | 120,907,328: 1,972 input, 725,575 output, 117,831,895 cache read, 2,347,886 cache write |
| Questions to the maintainer | 23, of them 10 permission requests                                                      |

## By node

| Node              | Model             | Sessions |   Cost | Output tokens | Cache read | Cache write |
| ----------------- | ----------------- | -------: | -----: | ------------: | ---------: | ----------: |
| start.frame       | claude-sonnet-5-5 |        1 |  $0.20 |         3,430 |    196,497 |      37,498 |
| plan.spec         | claude-sonnet-5-5 |        1 |  $0.41 |        20,412 |    334,929 |      42,687 |
| build.engine      | claude-opus-5-5   |        7 | $19.46 |       195,571 | 49,285,016 |     512,623 |
| build.implement   | claude-sonnet-5-5 |        4 |  $3.60 |        87,952 | 15,051,054 |     303,453 |
| build.engine-2    | claude-opus-5-5   |        1 |  $2.27 |        30,140 |  3,721,813 |     114,690 |
| build.implement-2 | claude-sonnet-5-5 |        1 |  $1.27 |        38,722 |  3,845,453 |     121,141 |
| build.engine-3    | claude-opus-5-5   |        1 |  $4.21 |        69,304 |  7,773,659 |     157,783 |
| build.implement-3 | claude-sonnet-5-5 |        1 |  $0.63 |        17,780 |  1,551,197 |      74,419 |
| build.engine-5    | claude-opus-5-5   |        1 |  $4.21 |        61,154 |  8,112,933 |     170,188 |
| build.engine-4    | claude-opus-5-5   |        1 |  $4.61 |        69,276 |  9,539,091 |     164,516 |
| build.build       | claude-sonnet-5-5 |        5 |  $1.79 |        49,551 |  6,084,026 |     171,230 |
| build.review.1    | claude-opus-5-5   |        5 |  $2.38 |        22,394 |  3,527,779 |     153,352 |
| build.review.2    | claude-opus-5-5   |        5 |  $2.13 |        25,207 |  3,467,875 |     116,161 |
| build.review.0    | claude-opus-5-5   |        5 |  $2.89 |        30,638 |  4,987,418 |     160,287 |
| build.docs        | claude-sonnet-5-5 |        1 |  $0.27 |         4,044 |    353,155 |      47,858 |

## How it ran

- The first feature to go the whole way from a brief through Ork's own gateway:
  `start` recommended building from the RFC, `plan`'s spec writer asked the
  maintainer four design questions before the plan was approved, and `build`
  built it.
- The leader sent the engine work in waves. Builders ran for 106 minutes: 57.2
  with one at a time, 33.6 with two and 15.5 with three.
- Two design questions the plan didn't settle came from builders to the
  maintainer (how a Command Code session waits for its checkout, and how its
  allow and deny lists are enforced), instead of being decided by an agent.
- Five review rounds by three reviewers (correctness, tests, repository rules).
  Round 2 found a deadlock between an owner and its owned node on Command Code
  that validation only warned about; the two rounds the maintainer granted past
  the loop's two closed the last finding (an ADR the change still lacked), and
  round 5 came back clean.
- Neither new driver ran against a real OpenCode or Command Code session: those
  two checks need the maintainer's paid logins, so both drivers ship marked
  unproven and refused until they pass.

## What went wrong

- **The budget ran out, and was passed.** `build` ended `budget_exhausted` at
  $36.66 against $35, before review: two builders started side by side were each
  offered all that was left, and the leader's own long session counted only when
  it ended. An Ork limit; fixed afterwards, so each session now sets its cap
  aside as it starts (ADR-077). The maintainer raised the cap and resumed the
  run, which went on from its recorded results.
- **The first review after the resume read the wrong checkout.** A resumed run
  did not remember where a replayed node had worked, so the reviewers read the
  project root instead of the leader's branch ($0.98, one round). An Ork bug,
  fixed afterwards.
- **One reviewer's later findings never reached the leader.** The message that
  sends a loop back cut the three reviews at 8 KiB. An Ork limit, fixed
  afterwards with the `read_input` tool (ADR-078).
- **One engine session hit its 80-turn limit** ($4.28) without a report; the
  leader sent it back to finish. One builder carried too much at once.
- **10 permission requests:** 8 to fetch the agent CLIs' documentation, which
  the project's rules allowed only after this run had started, and 2 for a
  reviewer's shell command.
- **`start` ended `failed`.** It stopped waiting when `build` first ran out of
  budget; `build` was then resumed on its own and finished.

## Against a manual session

The change is 11,097 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$50.22**
($32.84–$75.63) and take **154 working minutes** (97–401).

Ork cost about the same as the manual median, and its working time was 150
minutes against 154.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `d07aa32`).
