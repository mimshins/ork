---
"@krapht/ork": patch
---

A `readonly` or `continue` node after a tool node whose `cwd` is in one of the
run's worktrees works in that worktree, not the project root, also on resume.
