# Models, effort and budgets

Every Claude node picks its own model and effort, and has its own limits, so a
planner can think hard on a large model while reviewers run fast and cheap. The
run as a whole has a hard budget.

## Model and effort

```yaml
defaults:
  model: sonnet
  effort: medium
nodes:
  planner:
    type: claude.leader
    model: opus
    effort: high
  linter:
    type: claude.worker
    parent: planner
    model: haiku
    effort: low
```

- `model`: `opus`, `sonnet`, `haiku`, or a full model id such as
  `claude-opus-5-5`.
- `effort`: how hard the model thinks, `low`, `medium`, `high`, `xhigh` or
  `max`.
- A node's own value wins, then `defaults`, then Claude Code's default for the
  model. A spawned worker (`tests-2`) takes its template's.

## Limits per node

```yaml
nodes:
  builder:
    type: claude.worker
    budgetUsd: 3 # this session's spend cap
    maxTurns: 60 # this session's turn cap
```

Both can also go in `defaults`. A session that hits a limit ends, and without a
valid report its status is `fail`, so a `when: status == 'fail'` edge can handle
it.

## Limits per run

```yaml
limits:
  budgetUsd: 20 # hard cap for the whole run
  concurrency: 2 # Claude sessions at once (default 4)
```

- Each session gets the smaller of its own budget and what is left of the run's.
  Once the run's budget is spent, counting what sessions still running have
  reported so far, no new session starts and the run ends as `budget_exhausted`.
- A `workflow.call` shares this budget with the run it starts
  ([calling a workflow](./working-across-projects.md#calling-a-workflow)).
- `concurrency` limits only Claude sessions; tools and gates are not limited. A
  leader waiting on its children lends them its slot. It counts this run's
  sessions only: two runs at the default can hold 8. To cap spending across
  runs, use [quotas](#limits-across-runs).

Costs come from Claude Code's own estimate, reported at the end of each turn and
in each session's final result. The run summary shows the total, and `--json`
gives each node's usage: cost, tokens (including cache reads and writes), turns
and time. To see them over time, see [what you spent](#what-you-spent).

## Limits across runs

A run's budget is one workflow's. To cap what your runs spend together, set
quotas:

```yaml
# ~/.ork/settings.yaml: every project on this machine
schemaVersion: 1
quotas:
  dayUsd: 20
  monthUsd: 300
```

```yaml
# .ork/project.yaml: this project
quotas:
  dayUsd: 5
```

- **All that apply are enforced,** so a repository can lower what you spend but
  can't raise your own cap. `weekUsd` takes weeks from Monday.
- **At a cap,** nothing new starts, what is working finishes under what was
  left, and the run ends `quota_exhausted`, saying when it lifts. `ork resume`
  goes on from there, in the same session, then or once you raise the cap.
- **While a cap is spent,** `ork run` refuses a workflow with a Claude session
  or a call. One of only tool nodes still runs. `ork chat` still works, says so,
  and counts.
- **A cap can be passed.** Running sessions don't see what each other spend
  until they finish, so the most it passes by is what they were given. Lower
  caps or `limits.concurrency` make that smaller.
- **On a subscription** these are a yardstick, as costs are estimates and not a
  bill. What stops you there is your plan's rate limit: when Claude Code says
  the plan has refused a session, every run here stops starting sessions until
  the time it gives, and `ork resume` goes on. If the limit lifts sooner, make
  Ork forget it with `ork usage --clear-plan-limits`.

`ork usage` and the Usage panel show each cap, what it has left and when it
resets.

## Timeouts

A run has no time limit unless you set one:

```yaml
defaults:
  timeout: 30m # each tool, Claude and call node that sets none
limits:
  timeout: 2h # the whole run
nodes:
  build:
    type: tool.shell
    command: pnpm build
    timeout: 5m # this node
```

- Write `30s`, `15m` or `2h`. Time spent waiting on you doesn't count: a pause,
  a question, or a permission prompt, including one from a node a leader owns.
- A node that runs out is stopped and fails, with `timedOut` in its output, so
  an edge can handle it: `when: timedOut`. Its command, and anything that
  started, is killed; a `workflow.call` stops the run it called.
- A run that runs out ends as `timed_out`, and `ork resume` continues it. The
  clocks start again.
- A `claude.subagent` runs inside its parent's session, so set the timeout on
  the parent. A `human.gate`'s own `timeout` is separate: its `default` answers.

## The driver

```yaml
defaults:
  driver: claude-code
```

`driver` picks how Ork reaches Claude, per workflow or per node, and
`ork run --driver` overrides both. With none named, a run uses the driver that's
ready on the machine running it. Today that is `claude-code`, your own `claude`;
`open-code` and `command-code` are built but not proven yet, so they are refused
([Drivers](./drivers.md), [Accounts and credentials](./accounts.md)).

`ork validate` and `ork run` refuse a node its driver can't serve, naming both
([troubleshooting](./troubleshooting/setup.md)).

## What you spent

`ork usage` adds up what this project's sessions spent over the last 30 days:

```sh
ork usage                     # totals, by day, workflow, model and costliest node
ork usage --all --since 90d   # every project, further back
ork usage --by node           # one table, in full
ork usage --json
```

`--since` and `--until` set the period; `--by` is `day`, `week`, `month`,
`workflow`, `node`, `model`, `driver` or `project`. The **Usage** panel in
[the browser view](./browser-view/panels-and-workspace.md#the-panels) shows the
same, with a chart. Both point at what is worth a look: spend on loop rounds, on
failed sessions, on one costly node, or a cold prompt cache.

These are Claude Code's estimates, so on a subscription they are not your bill.
They can differ from adding up `ork ps`: usage counts `ork chat` sessions, and
counts a called workflow once.

Old runs' logs can go while what they spent stays:

```sh
ork prune --older-than 90d --dry-run   # see what would go
ork prune --older-than 90d             # asks first
```

A pruned run can no longer be read or resumed. Runs with a worktree or branch
left stay until `ork worktrees clean` deals with those. Ork never prunes on its
own.

## Saving tokens

Ork is built to keep sessions small:

- Workers start a fresh session for each task; only leaders are long-lived, and
  a leader resumes its session instead of starting over.
- Owners pass briefs, not transcripts, and children return short summaries.
- What Ork adds to the prompt is ordered so nodes share a cached prefix
  ([Skills and context](./skills-and-context.md)).
- The built-in `caveman` practice keeps chat and reports terse.
- Every loop has a `maxRounds`, so nothing runs forever.

A good start: `opus` with `high` effort for the node that plans, `sonnet` for
the ones that build, and `haiku` or `low` effort for checks and reviews. Use
`ork context explain` to see how big each node's prompt is.

For the full rules: [usage](../../specs/usage.md) and
[the drivers](../../specs/runtime.md#the-drivers).
