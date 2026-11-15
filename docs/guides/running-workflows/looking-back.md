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

## Runs a run called

`ork logs <run>` prints the runs a `workflow.call` started right after the
`call.started` line that started them, at any depth, under the same
`<call node> › ` gutter a foreground run shows (the id of the `workflow.call`
node, `plan › ` for `start`'s), so a `start` run's log reads as one transcript.
`--no-calls` prints the caller only. With `--json` the called runs are left out
unless you add `--calls`; their lines carry their own `runId`. `--node`,
`--since` and `--until` apply to every run printed, and `--limit` keeps the last
lines overall, not per run. `ork logs -f <run>` follows called runs live, ends
when the run ends, and lists called runs still going:
`↳ run 86d5fe37 still running · ork attach 86d5fe37`.

## Follow every live run

```sh
ork logs -f --all                  # every live run of this project, interleaved
ork logs -f --all --project all    # every project
ork logs -f --all --workflow start --until-idle
```

Each line starts with the run's first four id characters and its workflow:
`3f2a start › plan │ ✓ pass: Drafted the spec`. Lines of all the runs are in the
order they were stored, the stored ones first and new ones after, each up to one
poll (about 250 ms) after it happened. A run that starts later joins within
about a second, and a called run prints once. `--limit` keeps the last N lines
overall in the order the runs are read, not by time. `--all` needs `-f` and
takes no run id; `--workflow` keeps only that workflow's runs and the runs they
call, and `--since`, `--until`, `--limit`, `--node` and `--json` work as for one
run (`--json` prints the stored events, which carry `runId`, with no prefix).
Ctrl-C ends it, and so does `--until-idle` when no live run is left. Both
exit 0. To answer the questions of those runs, use
[`ork decide --follow`](./attaching-to-a-run.md#answering-for-several-runs-ork-decide---follow).

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
