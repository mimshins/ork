# Next release

_Part of [What's new](../whats-new.md)._

What lands on `main` is listed here until it ships.

- **A leader's `questions: owner` now forks the leader when it has its own
  worktree.** A leader on the default `worktree` isolation failed the fork's
  plan, so its children's questions went to you with no fork and no word of why.
  The fork now starts from the leader's worktree and answers, or passes the
  question on, as the guide says
  ([questions to a leader](../guides/leaders-and-delegation/messages-questions-and-budget.md)).
  Upgrade: none required; a leader whose questions used to reach you may now be
  answered by its fork first.
