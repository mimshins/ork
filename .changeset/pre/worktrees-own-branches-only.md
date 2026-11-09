---
"@krapht/ork": patch
---

`ork worktrees clean` and `remove` no longer delete an `ork/` branch no run
recorded creating; it is listed as "not created by Ork" and kept.
`clean --force` now lists the uncommitted files and unmerged commits it would
lose before asking. An unknown `--run` is an error, "Nothing to clean." is not
printed after kept items, declining prints `Cancelled.`, `remove` resolves a
symlinked path, and `ork worktrees` in a repository with no commit prints an
empty list.
