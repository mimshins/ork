# The Codex driver: OpenAI's `codex` as Ork's fourth agent

Ork's `start` workflow routed the Accepted
[RFC-024](../../rfcs/archived/RFC-024-codex-driver.md) to `plan` and then to
`build`, which added `codex` as a fourth agent driver beside Claude Code,
OpenCode and Command Code. The change runs `codex exec` once per leg (one
process of a session), with Ork's tools served over MCP. A per-session hook
holds the node's tool rules and refuses when anything fails. Codex's sandbox is
chosen from the node's permissions, and usage is counted in tokens. It also adds
a `readDenies` capability, so a path-scoped read deny is refused on a driver
that can't enforce it, and moves Command Code's rule matcher into a module both
drivers share. The driver ships unproven: `ork run` refuses it until it has been
tried on a real `codex`. Run `9e81055a` on 2026-11-18, Ork 1.0.0-alpha.24, with
Claude Code as the agent (CLI driver). The run committed and pushed the change
itself, through its own `publish` step, as
[`3c68367`](https://github.com/mimshins/ork/commit/3c683670): 81 files, +3,832 /
−475.

## At a glance

|                             |                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Status                      | succeeded                                                                             |
| Cost                        | **$23.86** (the `start` workflow's cap was $70)                                       |
| Ork working time            | **76.6 min**                                                                          |
| Waiting on the maintainer   | 13.2 min                                                                              |
| Wall time                   | 90 min                                                                                |
| Claude sessions             | 29 (0 failed), 827 turns                                                              |
| Tokens                      | 61,272,626: 1,008 input, 407,136 output, 59,231,045 cache read, 1,633,437 cache write |
| Questions to the maintainer | 9: 1 design question from a builder, 8 workflow gates; no permission requests         |

## By node

| Node      | Model             | Sessions |   Cost | Output tokens | Cache read | Cache write |
| --------- | ----------------- | -------: | -----: | ------------: | ---------: | ----------: |
| frame     | claude-sonnet-5-5 |        1 |  $0.23 |         4,808 |    489,622 |      32,280 |
| spec      | claude-sonnet-5-5 |        1 |  $0.65 |        27,813 |    880,763 |      69,927 |
| engine    | claude-opus-5-5   |        6 | $12.78 |       169,237 | 30,312,988 |     416,094 |
| implement | claude-sonnet-5-5 |        8 |  $4.89 |       116,865 | 18,986,420 |     456,098 |
| build     | claude-sonnet-5-5 |        2 |  $0.53 |        19,595 |    800,948 |      63,256 |
| review.0  | claude-opus-5-5   |        2 |  $1.89 |        21,020 |  2,675,193 |     116,613 |
| review.1  | claude-sonnet-5-5 |        2 |  $0.88 |        17,645 |  1,672,250 |     134,413 |
| review.2  | claude-sonnet-5-5 |        2 |  $0.99 |        20,184 |  2,566,036 |     133,796 |
| followups | claude-sonnet-5-5 |        1 |  $0.17 |         1,417 |          0 |      37,932 |
| polish    | claude-sonnet-5-5 |        1 |  $0.17 |         1,164 |    105,614 |      36,900 |
| docs      | claude-sonnet-5-5 |        1 |  $0.31 |         3,895 |    552,046 |      55,025 |
| repair    | claude-sonnet-5-5 |        1 |  $0.17 |         1,051 |    106,233 |      36,780 |
| declare   | claude-sonnet-5-5 |        1 |  $0.21 |         2,442 |     82,932 |      44,323 |

`frame` is `start`'s routing step and `spec` is `plan`'s; the rest are `build`.
`engine` and `implement` count every instance the leader spawned (`engine-2`,
`implement-3` and so on).

## How it ran

- **Routing and the plan.** `start` read the brief and the RFC and proposed
  `plan` then `build`. `plan` wrote the plan in 6 minutes, and the maintainer
  approved it at its gates.
- **Building.** The leader ran for 47 minutes and handed the plan's tasks to its
  builders in four waves, each builder on its own worktree:
  - Minutes 0 and 11: an `engine` session on the runtime side, beside an
    `implement` session on the driver's descriptor and doctor check, then on the
    schema, core and nodes. Two at once each time. The second `implement` asked
    the maintainer how to refuse a path-scoped read deny on Codex; the
    maintainer chose a new descriptor capability.
  - Minute 20: `engine` the Codex adapter and its wiring.
  - Minute 30: `engine-2` the fake `codex`, the driver contract entries and the
    tests, while `implement-2` brought the CLI's tests and fixtures to four
    drivers and `implement-3` worked on the docs. Three at once.
  - Minute 43: one `implement` session wrote ADR-102, archived the RFC and
    verified the change.
- **Review.** Three reviewers, one concern each (correctness, tests, repository
  rules), took two rounds:
  - Round 1 failed on repository rules. Several specs still listed three
    drivers, and the release note didn't say that `ork validate` and `ork run`
    refuse the driver until it is proven. Correctness and tests passed, with
    notes.
  - An `implement` and an `engine` session fixed the findings and most notes in
    10 minutes: the specs, the note, Codex's own `error` lines on a failed exit,
    shell quoting of the hook command, and an empty `CODEX_HOME`. Round 2 passed
    all three.
- **Gates.** The maintainer took the recommended handling of the follow-ups (the
  run then did one of them: a broader filter for Codex's hook-trust warning),
  ratified the decisions the agents had made, and chose to commit to main.

## What went wrong

- **The full test suite failed once, after the commit.** A repository test
  checks that quoted text in the source reads as messages to the user, and it
  flagged a template string in the new hook's shell quoting. The workflow's
  `repair` step rewrote it as plain concatenation, with the same output, in one
  session, and the check passed on its second round. Workflow: this is the
  designed path (targeted tests while building, the full suite once at the end);
  it cost about 2 minutes.
- **A flaky test in the suite.** A builder found that a CLI failure test raced
  its own interrupt handler, and fixed it in the same change. Ork: a test-only
  fix.
- **Nothing was run on a real `codex`.** All of the driver's tests use a fake
  `codex`. That is by design: the driver stays unproven until the maintainer's
  gate run on the real CLI.

## Against a manual session

The change is 4,292 changed lines. At the rate measured in plain Claude Code
sessions on this repository, the same change would cost **$19.97**
($12.05–$30.05) and take **65.2 working minutes** (37.8–166.8).

Ork cost 19% more than the manual median, inside the manual range, and its
working time was 76.6 minutes against 65.2.
[How the manual estimate is made](../method.md#the-manual-baseline).

## Files

- `summary.json`: the numbers above, per node and per activation.
- `usage.csv`: one row per Claude session.
- `inputs/brief.md`: what the run was asked; `inputs/workflow/`: the workflows,
  `project.yaml` and agents as the run read them (commit `703550b`).
