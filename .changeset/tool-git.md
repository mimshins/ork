---
"@krapht/ork": minor
---

New: `tool.git` nodes run your own `git`, so a commit can be an explicit step
after your gates. Without `allow`, a `tool.git` node may run `add` and `commit`;
`push` and anything else need the node's own `allow`. Its output has `staged`
(the `git diff --cached --stat` summary), `diff` (the staged patch) and `head`,
so a gate after an `add` step shows exactly what will be committed.
`ork worktrees clean` keeps a detached worktree holding a commit no branch has
unless `--force`, and `ork doctor` says whether your git identity is set.
