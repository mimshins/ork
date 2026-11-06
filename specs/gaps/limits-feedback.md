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
