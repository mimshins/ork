# Your runs, and what they leave

_Part of [Running workflows](../running-workflows.md)._

## Look back at runs

```sh
ork ps                 # this project's runs, newest first (--all: every project)
ork logs               # the newest run's transcript; or ork logs <run-id>
ork logs 3f2a -f       # follow a run that is still going, by an id prefix
ork logs --node review # one node's events
ork tree               # the ownership tree: each node's state, tokens and cost
```

A run a `workflow.call` started shows its cost as `$0.42 in <caller>`, since the
caller's cost already counts it. `ork ps --json` adds each finished run's
`skipped` and `failuresHandled`.

What `ork ps` shows for a run, and whether `ork resume` picks it up:

| Status             | What it means                              | Resume? |
| ------------------ | ------------------------------------------ | ------- |
| `running`          | still going                                | no      |
| `paused`           | waiting for `ork continue`                 | no      |
| `succeeded`        | finished                                   | no      |
| `failed`           | a node failed and nothing handled it       | yes     |
| `interrupted`      | you stopped it                             | yes     |
| `crashed`          | its process ended without finishing        | yes     |
| `budget_exhausted` | its `limits.budgetUsd` ran out             | yes     |
| `quota_exhausted`  | a limit across runs, or your plan, ran out | yes     |
| `timed_out`        | its `limits.timeout` ran out               | yes     |

## What a run leaves behind

- Branches `ork/<run>/<node>`, and worktrees beside your clone for the results
  ([Worktrees](../worktrees.md)).
- Run state under `.ork/runs/<run>/`, gitignored: long tool output and a copy of
  the run's events.
- The run's record in `~/.ork/state.db`, with secrets masked
  ([where Ork keeps things](../where-ork-keeps-things.md)).
