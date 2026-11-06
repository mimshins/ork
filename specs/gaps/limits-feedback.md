# Limits: the feedback loop

_Part of [Known gaps and limits](../gaps.md)._

How closing the feedback loop works for now, by choice
([feedback](../feedback.md),
[ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)).

- **L149 · An item's status follows the `apply` that started its run.**
  `ork feedback apply` marks the item `resolved`, or removes a discarded fix's
  branch, when it sees its run of `ork:feedback-apply` end. If that process is
  stopped and the run finished later with `ork resume`, the item stays
  `accepted`, and a discarded branch stays until `ork worktrees clean`.
  Recording the item on the run, so any process that ends it settles the item,
  would close this.
- **L150 · A publish looks for its thread among 100.** Ork reads the "Agent
  feedback" category's 100 most recently updated threads for the item's marker.
  A thread quieter than those gets a second thread for the same problem instead
  of a "+1". GitHub's search doesn't reliably index a hidden marker; paging
  through the whole category would close this.
- **L151 · Export carries records, not their items' state.** An imported record
  joins its item by fingerprint, and a new item starts `new`: a status, a merge
  or a lesson made elsewhere doesn't travel.
- **L152 · The Feedback panel proposes a fix with the default driver.** Its
  Propose fix starts `ork:feedback-apply` as `ork feedback apply` without
  `--driver` does; the route takes a driver, but the panel offers no choice. The
  Run workflow dialog's driver field beside the confirmation would close this.
- **L153 · Merging items is only in the CLI.** The Feedback panel splits a
  merged item, but merges are made with `ork feedback triage`, which shows each
  group and asks. A plan-then-merge pair of routes and a dialog of groups, each
  unchecked to start, would close this.
- **L154 · The Feedback panel follows the runs, not the feedback.** No stream
  says a record was added, so the panel reads the items again when the runs
  change while it shows, at most every 5 s, and after each action. A run's
  `feedback.recorded` on the overview stream, or a count of records, would let
  it follow feedback itself.
