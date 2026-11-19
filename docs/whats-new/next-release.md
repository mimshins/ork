# Next release

_Part of [What's new](../whats-new.md)._

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
