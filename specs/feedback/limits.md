# Limits: the feedback loop

_Part of [Feedback and self-improvement](../feedback.md)._

How closing the feedback loop works for now, by choice
([feedback](../feedback.md),
[ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)). Those the gaps
review carried are open work in the [register](../gaps.md#limits).

- **L149 · An item's status follows the `apply` that started its run.**
  `ork feedback apply` marks the item `resolved`, or removes a discarded fix's
  branch, when it sees its run of `ork:feedback-apply` end. If that process is
  stopped and the run finished later with `ork resume`, the item stays
  `accepted`, and a discarded branch stays until `ork worktrees clean`.
  Recording the item on the run, so any process that ends it settles the item,
  would close this.
- **L150 · A publish looks for its thread among 1,000.** Ork reads the "Agent
  feedback" category's threads, most recently updated first, a page of 100 at a
  time, up to 1,000, for the item's marker. A thread quieter than those gets a
  second thread for the same problem instead of a "+1". GitHub's search doesn't
  reliably index a hidden marker.
- **L151 · Export carries records, not their items' state.** An imported record
  joins its item by fingerprint, and a new item starts `new`: a status, a merge
  or a lesson made elsewhere doesn't travel.
- **L153 · Merging items is only in the CLI.** The Feedback panel splits a
  merged item, but merges are made with `ork feedback triage`, which shows each
  group and asks. A plan-then-merge pair of routes and a dialog of groups, each
  unchecked to start, would close this.
- **L154 · The Feedback panel follows the runs, not the feedback.** No stream
  says a record was added, so the panel reads the items again when the runs
  change while it shows, at most every 5 s, and after each action. A run's
  `feedback.recorded` on the overview stream, or a count of records, would let
  it follow feedback itself.
- **L195 · A tool error's record doesn't say what the error was.** `tool.error`
  feedback points at the node's events, but they keep only that the call failed.
  A short, scrubbed copy of the message would make it possible to diagnose.
- **L196 · An expected refusal is filed as an Ork bug.** A refused claim is a
  tool error, so it becomes medium-severity `ork/bug` feedback even though a
  refusal is claims working. It shouldn't count as a tool error.
