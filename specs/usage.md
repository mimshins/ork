# Usage: what runs spent over time

Status: **Built**: the ledger, reports, `ork usage`, `ork prune`,
`GET /api/usage`, the Usage panel and limits across runs
([ledger](../packages/core/src/store/usage.ts),
[reports](../packages/core/src/usage/report.ts),
[prune](../packages/core/src/store/prune.ts),
[commands](../packages/cli/src/commands/usage.ts),
[panel](../packages/ui/src/panels/usage-panel.tsx),
[tests](../packages/core/test/usage.test.ts)). Why:
[ADR-046](../decisions/ADR-046-usage-ledger-and-prune.md) and
[ADR-050](../decisions/ADR-050-limits-across-runs.md).

Usage answers where the money went and what to improve. No model is involved:
the ledger is folded from a run's events, and a report is a pure function of it.

## The ledger

`usage` in `~/.ork/state.db` has one row per finished Claude session, written as
its `session.finished` event is appended
([event store](./event-store.md#runs-and-events)). A row has its run, event
number and time; its project and workflow; the node and, for a spawned worker,
its template; the model and driver; and its cost, tokens, turns and duration.

- **`kind`:** `node`, or `chat` when `ork chat` resumed the session after its
  node finished.
- **`round`:** the node's round, above 1 when a loop sent the work back.
- **`failed`:** the session errored, or reported `fail`.

Only sessions have rows. A `workflow.call` node's usage is its called run's, so
a called run counts once. A session cut off before it reported has no row until
it is resumed, and its total then includes the part that was cut off.

### What a resumed session spent

Claude Code reports a resumed session's cost as the session's total so far,
carried over from its transcript, while its tokens, turns and duration are that
process's own. So a row's cost is what the session reported minus what it had
reported before; the other numbers are used as they are.

Two reports read differently. A total of zero is a crash or startup error saying
nothing, so it adds nothing and the session's total stands. A total below the
last one is a session whose transcript had no total to carry, so all of it is
new.

The scheduler reads each result the same way
([`ownSpend`](../packages/core/src/usage/spend.ts)) before it counts towards the
run's budget and its `ork ps` and `ork tree` totals
([budget](./scheduler.md#budget-and-concurrency)). A resumed run goes on from
what its nodes recorded, and from each session's last total once its node
finished. A session cut off before that has recorded nothing, so its next total
counts the part that was cut off. The ledger and the scheduler can differ in one
way: a chat's spend has a ledger row, and is left out of the run's budget.

## Reports

A report has the **totals**: cost, tokens, cache hit rate, turns, duration,
sessions and runs, and the cost of failed sessions, of rounds after the first
and of chats. It has the same totals **grouped** by day, week, month, workflow,
node, model, driver and project. Times are oldest first in the machine's time
zone, and the rest costliest first. A spawned worker's sessions group under its
template.

The **cache hit rate** is cache reads over all input: fresh, cache read and
cache write.

**Hints** are thresholds on those numbers, and only from $0.50 of spend:

| Hint           | When                                                      |
| -------------- | --------------------------------------------------------- |
| `rework`       | 20% or more went to loop rounds after the first           |
| `failed`       | 10% or more went to sessions that failed                  |
| `concentrated` | One of several nodes took 50% or more                     |
| `cache`        | Under 50% of 100,000 or more input tokens came from cache |

Costs are Claude Code's own estimates. On a subscription they are not what the
user is billed ([L74](./gaps/limits-usage.md)).

## Limits across runs

[quota.ts](../packages/core/src/usage/quota.ts),
[caps.ts](../packages/core/src/usage/caps.ts),
[tests](../packages/core/test/quota.test.ts).

`quotas` takes `dayUsd`, `weekUsd` and `monthUsd`, in `~/.ork/settings.yaml` for
every project on this machine and `.ork/project.yaml` for one. All that apply
are enforced, so a project can't raise the user's. A window is the calendar day,
week from Monday or month in the machine's time zone, as in a report. What
counts is the ledger in it, so `ork chat` and called runs do, and a call into
another project counts there and against the user's caps.

- **`ork run`** refuses a workflow with a session or a call while a limit is
  spent, or while it can't read its settings, and so does a resume with one of
  those left to run. A tool-only workflow still runs.
- **While running,** the scheduler checks before each session and call, and a
  node checks again before its session starts, and before each late turn or
  `verify:` retry. A session may spend no more than what is left of any cap. The
  files and the ledger are read each time, so a changed cap reaches a running
  run; a file that breaks meanwhile keeps the last it could read.
- **At a limit** nothing new starts, what is working goes on under its cap, and
  the run ends `quota_exhausted`, saying which limit and when it lifts. A node a
  limit ended is cut off, so no edge acts on its failure, and `ork resume`
  continues its session. That is a session that reached a cap that was a
  quota's, one its plan refused that gave no report, one with no retry left for
  a limit, and a call whose run ended `quota_exhausted` or was refused at its
  start. Any other failure stays a failure, even while a limit is spent.
- **Plan limits:** Claude Code reports a subscription's limits as
  `rate_limit_event`, normalized to `plan.limit`, and the store keeps the latest
  of each window. While one on the whole account (`five_hour`, `seven_day`,
  `overage`) is `rejected` and its `resetsAt` is ahead, no run here starts a
  session. One on a single model, such as `seven_day_opus`, stops only the
  session it refused. A `rejected` with extra usage to draw on (`overageStatus`)
  counts as `allowed_warning`, which is shown and changes nothing. A session
  that goes on to succeed is left alone. `ork usage --clear-plan-limits` forgets
  them, for one that has lifted early.
- **`ork chat`** counts, and says when a limit is spent. It isn't stopped.
- **A call that activates a finished run again** is held as any session, as a
  workflow did it and not a person.
- **A called run** reads the quotas for itself, so its `--budget-cap` is only
  its caller's budget.

A cap can be passed ([L99](./gaps/limits-usage.md)) and sees only this store
([L100](./gaps/limits-usage.md)).

## `ork usage`

```sh
ork usage [--all] [--since 30d|2026-11-01|all] [--until 2026-11-30]
          [--by day|week|month|workflow|node|model|driver|project]
          [--workflow <name>] [--json]
```

This project's sessions from the last 30 days, or `--all` projects'. Days and
weeks in `--since` are whole days counting today, as in the Usage panel; hours
are exact. A report's `runs` counts runs with a session, not those that only ran
tools. Without `--by` it prints the totals, the latest 10 days and the costliest
10 of each of workflow, model and node, then any hints; with it, that one table
in full. Any limits go first. `--json` prints the whole report, with `limits`.

## `ork prune`

```sh
ork prune --older-than 90d|12w [--all] [--dry-run] [--yes]
```

Forgets this project's runs, or `--all` projects', whose last event is that old,
so a recent `ork chat` keeps a run: the record, events, decisions, commands and
ended links, including those shared with a run that stays, and the run's folder.
It lists them and asks first, and looks again after the answer. The store's file
then shrinks, unless a run is going or the store is busy: its free space is used
first, and the next prune tries again. Ork never prunes on its own
([L72](./gaps/limits-ledger.md)).

What stays: the ledger, so `ork usage` is unchanged, and feedback records.

A run stays, and says why, if it:

- is still running;
- has a live link;
- has a worktree or branch left, since `ork worktrees` finds those through its
  events. `ork worktrees clean` deals with them first. If git fails, the run
  stays and says so; a project folder that is gone or no longer a repository has
  nothing left to clean up ([L78](./gaps/limits-ledger.md));
- belongs to a call with a run that must stay, or that is out of scope. A run
  and the runs it called go together or not at all.

A run that started again by the time it is deleted stays, and so does a folder
that cannot be removed; each is reported and the command exits with an error.

A pruned run reads as an unknown run: `ork logs`, `ork chat` and `ork resume`
say there is no such run.
