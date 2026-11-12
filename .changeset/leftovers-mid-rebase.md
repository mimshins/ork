---
"@krapht/ork": patch
---

Ork no longer commits what a node left in its worktree while a rebase, merge,
cherry-pick or revert is underway there. A node that resolves a rebase conflict
keeps its edits uncommitted for the step that finishes the rebase, instead of
having them committed before that step runs.
