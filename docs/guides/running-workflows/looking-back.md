# Your runs, and what they leave

_Part of [Running workflows](../running-workflows.md)._

## Look back at runs

```sh
ork ps                 # this project's runs, newest first, 20 (--project all: every project)
ork ps --status failed --since 7d --limit 5   # filter; --ids prints just the ids
ork logs               # the newest run's transcript; or ork logs <run-id>
ork logs 3f2a -f       # follow a run that is still going, by an id prefix
ork logs --node review # one node's events, with why it stopped and its details
ork logs 3f2a --since 1h --limit 50   # recent events; --limit keeps the last 50
ork logs 3f2a --verbose # every failed node's hint and scrubbed details
ork tree               # the ownership tree: each node's state, tokens and cost
```

For a `crashed` run, `ork tree` shows a node that had started but not ended as
`✗ cut off` and one that never started as `- not run`, as `ork ps` says the run
crashed (`--json` keeps the stored states).

A failed node says why in one line, as a kind and a message (for a failed tool,
the last line of its stderr); `--verbose` (on `ork run` too) and
`ork logs --node` add what to do and the raw text, scrubbed.
[Why a node stopped](../why-a-node-stopped.md) lists every kind.

A cost with `(partial)` after it leaves out a session on a driver that reports
no dollars, and the tokens counted are shown beside it
([what you spent](../models-and-budgets/driver-and-usage.md#what-you-spent)).

A run a `workflow.call` started shows its cost as `$0.42 in <caller>`, since the
caller's cost already counts it. `ork ps --json` adds each finished run's
`skipped` and `failuresHandled`.

What `ork ps` shows for a run, and whether `ork resume` picks it up:

| Status             | What it means                                    | Resume? |
| ------------------ | ------------------------------------------------ | ------- |
| `running`          | still going                                      | no      |
| `paused`           | waiting for `ork continue`                       | no      |
| `succeeded`        | finished                                         | no      |
| `failed`           | a node failed and nothing handled it             | yes     |
| `interrupted`      | you stopped it                                   | yes     |
| `crashed`          | its process ended without finishing              | yes     |
| `budget_exhausted` | its `limits.budgetUsd` or `budgetTokens` ran out | yes     |
| `quota_exhausted`  | a limit across runs, or your plan, ran out       | yes     |
| `timed_out`        | its `limits.timeout` ran out                     | yes     |

## What a run leaves behind

- Branches `ork/<run>/<node>`, and worktrees beside your clone for the results
  ([Worktrees](../worktrees.md)).
- Run state under `.ork/runs/<run>/`, gitignored: long tool output and a copy of
  the run's events.
- The run's record in `~/.ork/state.db`, with secrets masked
  ([where Ork keeps things](../where-ork-keeps-things.md)).
