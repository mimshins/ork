# Next release

_Part of [What's new](../whats-new.md)._

- **A run no longer ends on a budget that is not spent, and a worker waits
  instead of starting on a few cents.** A run capped by `limits.budgetUsd` or
  `budgetTokens` could end `budget_exhausted` with half its budget unspent: a
  worker offered the little that siblings' and a leader's set-aside budget left
  hit that cap and was blamed on the run. Now the run ends that way only when
  its budget is spent, and that worker fails as its own `budget_limit`, which an
  edge can route. A worker with its own cap that is offered less than it waits
  for a sibling worker to finish, then starts with its cap, so workers can run
  one after another under a tight budget. A refused start reads "nothing is left
  to start with: the run's budget is spent or set aside by running sessions"
  ([guide](../guides/leaders-and-delegation/messages-questions-and-budget.md#concurrency-and-budget)).
- **A fresh session for a builder's next task, off until you turn it on.** A
  worker with `session: resume` that its owner delegates to again resumes its
  old session, however long it has grown. Set `sessions.freshOver` in
  `.ork/project.yaml`, or in a workflow's `rules:`, to a number of tokens, and
  that worker's next task starts in a new session once the old one's context is
  over it. The new session is told its earlier tasks and what it reported, runs
  in the same worktree, and `ork logs` says when it happens. It saved about 7%
  of builder cost in past runs, but counts more tokens against `budgetTokens`,
  and what a fresh builder forgets is not measured yet. The default is `never`,
  so nothing changes until you set it
  ([guide](../guides/fresh-builder-sessions.md)).
