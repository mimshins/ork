---
"@krapht/ork": minor
---

The browser view has a **Worktrees** panel: what `ork worktrees` lists, for
every project at once, with **Remove…** for one worktree or branch and **Clean
merged…** for what's merged into each project's current branch. Each shows its
plan and its command, and asks; removing work that would be lost (uncommitted
changes, unmerged or unreachable commits) shows exactly what first and needs a
second, explicit confirm. A plan that changed after you read it removes nothing.

`ork worktrees remove <branch|path> [--branch] [--force] [--yes]` removes one,
the panel's twin: it prints the plan, and what's lost when it needs `--force`.
It changes only that item: a worktree whose folder is gone is dropped by its own
path, never by pruning every missing one.
