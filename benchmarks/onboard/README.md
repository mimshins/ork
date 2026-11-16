# `ork onboard`: proposing and writing a project's workflows

Ork's `build` workflow added `ork onboard` to Ork, in Ork's own repository, from
the Accepted [RFC-018](../../rfcs/archived/RFC-018-onboard.md). The command
checks the machine, surveys the repository, asks a few questions, and runs two
new built-in workflows: `ork:onboard-propose` suggests workflows with cited
evidence, and `ork:onboard-write` writes the ones the person picks on a branch
and stops at a gate that shows the diff. The run also added a pick-several
prompt, a hidden `ork __onboard` command for the workflows' tool nodes, tests on
all three agent drivers, the docs and ADR-097. Run `f7f49775` on 2026-11-16, Ork
1.0.0-alpha.21, with Claude Code as the agent (CLI driver). The run committed
and pushed the change itself, through its own `publish` step, as
[`ca789e8`](https://github.com/mimshins/ork/commit/ca789e8): 87 files, +7,366 /
−53. The plan it built came from a separate `plan` run ($0.62), not counted
here.

## At a glance

|                             |                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Status                      | succeeded                                                                             |
| Cost                        | **$21.77** (the workflow's cap was $50)                                               |
| Ork working time            | **73.7 min**                                                                          |
| Waiting on the maintainer   | 4.3 min                                                                               |
| Wall time                   | 78 min                                                                                |
| Claude sessions             | 25 (0 failed), 828 turns                                                              |
| Tokens                      | 67,682,007: 1,230 input, 408,035 output, 65,597,153 cache read, 1,675,589 cache write |
| Questions to the maintainer | 11: 6 permission requests, 2 design questions, 3 workflow gates                       |

## By node

| Node          | Model             | Sessions |  Cost | Output tokens | Cache read | Cache write |
| ------------- | ----------------- | -------: | ----: | ------------: | ---------: | ----------: |
| engine        | claude-opus-5-5   |        2 | $6.86 |        90,333 | 14,222,749 |     275,510 |
| implement     | claude-sonnet-5-5 |        8 | $9.85 |       242,633 | 42,496,216 |     794,148 |
| build         | claude-sonnet-5-5 |        2 | $0.43 |        13,526 |    642,645 |      56,925 |
| review.0      | claude-opus-5-5   |        2 | $1.99 |        20,880 |  3,229,628 |     115,944 |
| review.1      | claude-sonnet-5-5 |        2 | $0.78 |        14,294 |  1,890,079 |     113,117 |
| review.2      | claude-sonnet-5-5 |        2 | $0.63 |        10,397 |  1,832,838 |      85,032 |
| followups     | claude-sonnet-5-5 |        1 | $0.15 |         1,816 |          0 |      32,501 |
| polish        | claude-sonnet-5-5 |        2 | $0.25 |         3,911 |    385,140 |      44,194 |
| polish-review | claude-sonnet-5-5 |        1 | $0.18 |         3,150 |    222,077 |      31,492 |
| declare       | claude-sonnet-5-5 |        1 | $0.20 |         2,869 |     74,412 |      40,538 |
| docs          | claude-sonnet-5-5 |        1 | $0.28 |         3,345 |    490,920 |      48,288 |
| repair        | claude-sonnet-5-5 |        1 | $0.17 |           881 |    110,449 |      37,900 |

`engine` and `implement` count every instance the leader spawned (`engine-2`,
`implement-4` and so on).

## How it ran

- **Building.** The leader ran for 53 minutes and handed the plan's 12 tasks to
  its builders in five waves, each builder a fresh instance on its own worktree:
  - Minute 0: `engine` checked four unknowns in the drivers and wrote the specs,
    while two `implement` instances built the repository survey and history
    digest, and the pick-several prompt. Three at once.
  - Minute 8: `implement` built the hidden verbs, and `engine` the two built-in
    workflows, on the bundle mechanism shipped earlier that day. Two at once.
  - Minute 20: one `implement` built the cost preview and the command itself.
  - Minute 35: the end-to-end tests on the three fake drivers, and the docs, map
    and roadmap. Two at once.
  - Minute 47: the records: changeset, ADR-097, specs set to Built, RFC-018
    archived.
- **The engine's questions.** Engine stopped twice to ask the maintainer what
  the plan didn't settle: the dollar and token caps for the two built-ins (the
  maintainer picked the moderate option, $9 or 1.8M tokens in all), and whether
  the proposer's read-only tool list could stay as the plan wrote it, given that
  it lets the proposer read outside the project on two drivers. The maintainer
  kept it and had the risk recorded in the gaps register. Each answer took under
  two minutes.
- **Review.** Three reviewers, one concern each (correctness, tests, repository
  rules), took two rounds:
  - Round 1 sent back one finding each. Run from a subdirectory of a repository
    with no `.ork/`, `ork onboard` wrote `ork init`'s files into the
    subdirectory. Two of the plan's criteria had no test that failed without
    them. ADR-097 amended ADR-059 without ADR-059 saying so.
  - The leader sent the three to one `implement` session, which fixed them in 7
    minutes. Round 2 passed.
- **Gates.** The maintainer took the recommended handling of the follow-ups,
  ratified the decisions the agents made, and chose to commit to main: 3
  answers, all within seconds.

## What went wrong

- **The full test suite failed once, after the commit.** A repository test
  checks that quoted text in the source reads as messages to the user, and it
  read the YAML of the two new built-ins, now stored as text in a generated
  module. The builders ran only targeted tests, so the full suite first ran at
  the publish check. The workflow's `repair` step added the generated module to
  the test's exclusions, as the earlier built-in module already was, in 6 turns,
  and the check passed on its second round. Workflow: this is the designed path
  (targeted tests while building, the full suite once at the end); it cost about
  2 minutes.
- **One `spawn_worker` call failed.** The leader's first call to start the
  hidden-verbs builder returned an error that Ork doesn't record. The leader
  filed it as feedback on Ork and the same call succeeded at once. Ork: not yet
  diagnosed.
- **Six permission requests,** all from the agents:
  - Three were builders writing a new file with a shell `cd` followed by a
    here-document, which Claude Code asks about, instead of the editor tool.
  - Three were the rules reviewer's shell loops and pipelines over the changed
    files.

  All were allowed. Agent: each had a form that needs no prompt (the editor
  tool, or one simple command at a time).

## Against a manual session

The change is 7,419 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$33.58**
($21.96–$51.94) and take **112.8 working minutes** (65.3–288.4).

Ork cost 35% less than the manual median, just under the manual range, and its
working time was 73.7 minutes against 112.8.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflow,
  `project.yaml` and agents as the run read them (commit `da61e3f`).
