# Usage: what runs spent over time

Status: **Built**: the ledger, reports, `ork usage`, `ork prune`,
`GET /api/usage` and the Usage panel
([ledger](../packages/core/src/store/usage.ts),
[reports](../packages/core/src/usage/report.ts),
[prune](../packages/core/src/store/prune.ts),
[commands](../packages/cli/src/commands/usage.ts),
[panel](../packages/ui/src/panels/usage-panel.tsx),
[tests](../packages/core/test/usage.test.ts)). Quotas across runs are not built
([L39](./gaps/limits.md)). Why:
[ADR-046](../decisions/ADR-046-usage-ledger-and-prune.md).

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
user is billed, and Ork does not track rate limits ([L74](./gaps/limits.md)).

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
in full. `--json` prints the whole report.

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
([L72](./gaps/limits.md)).

What stays: the ledger, so `ork usage` is unchanged, and feedback records.

A run stays, and says why, if it:

- is still running;
- has a live link;
- has a worktree or branch left, since `ork worktrees` finds those through its
  events. `ork worktrees clean` deals with them first. If git fails, the run
  stays and says so; a project folder that is gone or no longer a repository has
  nothing left to clean up ([L78](./gaps/limits.md));
- belongs to a call with a run that must stay, or that is out of scope. A run
  and the runs it called go together or not at all.

A run that started again by the time it is deleted stays, and so does a folder
that cannot be removed; each is reported and the command exits with an error.

A pruned run reads as an unknown run: `ork logs`, `ork chat` and `ork resume`
say there is no such run.
