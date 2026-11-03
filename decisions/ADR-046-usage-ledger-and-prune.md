# ADR-046 — A usage ledger beside the events, and pruning by hand

- **Status:** Accepted
- **Date:** 2026-11-03
- **Topic:** store / engine accounting / CLI / UI
- **RFC:** none written; the options are below
- **Builds on:** [ADR-024](./ADR-024-event-store.md) (the event store),
  [ADR-045](./ADR-045-workflows-calling-workflows.md) (a call's cost)

## Context

Each run recorded what it spent, but nothing added it up over time, so a user
could not see where their money went or which workflow to improve. The store
also grew without end: nothing removed an old run.

Reading real runs to build this showed that Ork's costs were wrong. Claude Code
reports `total_cost_usd` for a resumed session as the session's total so far,
carried over from its transcript when that saved one, while its tokens, turns
and duration are that process's own. A crash's result may carry zero. The schema
text in Claude Code 2.1.317 says so. In one stored run, legs reported $0.00493,
$0.00549 and $0.00604, and the later legs' tokens fit about $0.0006 each. Ork
added these up in two places and counted a re-entered node's whole total again,
which overstated `ork ps`, `ork tree` and what a run's budget saw.

## Decision

**A ledger table.** `usage` holds one row per finished Claude session, written
as its `session.finished` event is appended, and filled from older runs when the
store migrates. Reports are pure functions over its rows. The contract is
[specs/usage.md](../specs/usage.md).

- **Sessions, not nodes,** are the source. A `workflow.call` node's usage is its
  called run's, which has rows of its own, so a called run counts once
  ([L54](../specs/gaps/limits.md)). `ork chat` spends outside any node and is
  counted too.
- **Rows carry their project and workflow,** so they outlive the run.

**A session's own spend.** A resumed activation's cost is what the session
reported minus what it had reported before. A zero adds nothing, and a lower
total counts in full. The ledger and the scheduler share this function. Merged
legs and a late-message turn take the later cost rather than the sum. Tokens,
turns and duration still add up. `ork resume` goes on from all the run had spent
rather than only the results it hands back.

**An event and what is derived from it are one write.** `append` puts the event
and its ledger row, cost and status in one transaction.

**Pruning is a command.** `ork prune --older-than <age>` removes a run's record,
events, decisions, commands, ended links and folder, after asking. Nothing is
deleted on its own, and there is no retention setting yet
([L72](../specs/gaps/limits.md)). The ledger and feedback records stay, so
`feedback` loses its foreign key to `runs`. A run stays while it is live, has a
live link, or has a worktree or branch left, since `ork worktrees` finds those
through its events, and a run's age is that of its last event. A run's calls go
with it or not at all.

## Options considered

- **Query the events for each report.** No new table, and no projection to keep
  right, but it reads and parses every session event of every run in the period,
  and pruning a transcript would erase what it cost.
- **Keep only the usage events when pruning.** No new table, but `ork logs` and
  `ork chat` would then see runs with holes in them, and each would have to
  know.
- **Keep the run's record when pruning, marked pruned.** Keeps the foreign keys,
  but every reader of a run (`logs`, `tree`, `resume`, `chat`, the Monitor)
  would need a pruned case. A run that is gone reads as any unknown run already
  does.
- **Prune on a schedule by default.** Deleting a user's history without being
  asked is the wrong default for a local tool, and a local tool has no always-on
  process to do it.

## Consequences

- Reports stay fast whatever the transcripts' size, and cost history survives
  pruning.
- The ledger is a projection: a change to how sessions are counted needs a
  migration to refill it, and pruned runs can no longer be refilled.
- Totals can differ from `ork ps`: the ledger includes `ork chat`, and counts a
  called run once. Runs recorded before this change keep their overstated
  `cost_usd`; only the ledger is corrected.
- Budgets now stop a run later than before when sessions resume, because they no
  longer count the same spend twice.
- A resumed run counts its failed nodes' spend, so one that ran out of budget
  ends again at once unless the workflow's budget is raised.
- A session's own `budgetUsd` cap is per process, as Claude Code's schema says,
  so it is passed as it was ([L73](../specs/gaps/limits.md)).
- The cumulative cost was seen on the CLI driver. The SDK driver runs the same
  Claude Code and is treated alike, unseen until [C5](../specs/gaps.md#chores)
  is done.
