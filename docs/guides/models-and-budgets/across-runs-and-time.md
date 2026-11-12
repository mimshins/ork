# Limits across runs and time

_Part of [Models, effort and budgets](../models-and-budgets.md)._

## Limits across runs

A run's budget is one workflow's. To cap what your runs spend together, set
quotas:

```yaml
# ~/.ork/settings.yaml: every project on this machine
schemaVersion: 1
quotas:
  dayUsd: 20
  monthUsd: 300
  dayTokens: 20000000 # tokens, on any driver
```

```yaml
# .ork/project.yaml: this project
quotas:
  dayUsd: 5
  dayTokens: 5000000
```

- **All that apply are enforced,** so a repository can lower what you spend but
  can't raise your own cap. `weekUsd` takes weeks from Monday. `dayTokens`
  counts what `budgetTokens` does (input, output and cache-write tokens), so a
  project on a driver with no prices still has a daily cap; once the day's
  counted tokens reach it, no new session starts.
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
resets; the token cap shows beside the dollar ones.

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
- An `agent.subagent` runs inside its parent's session, so set the timeout on
  the parent. A `human.gate`'s own `timeout` is separate: its `default` answers.
