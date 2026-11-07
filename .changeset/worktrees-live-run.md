---
"@krapht/ork": patch
---

`ork worktrees clean` no longer removes the worktree of a run that's still
going, even with `--force`: a node that hadn't committed yet looked merged, so a
plain clean could take its worktree from under it. The plan says "its run is
still going"; stop the run first. A worktree whose folder is gone now shows as
`prune worktree` in the plan, and the list's words read "2 commits not merged"
and "checked out in the main checkout".
