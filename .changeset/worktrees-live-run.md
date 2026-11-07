---
"@krapht/ork": patch
---

`ork worktrees clean` no longer removes the worktree of a run that's still
going, even with `--force`: a node that hadn't committed yet looked merged, so a
plain clean could take its worktree from under it. The plan says "its run is
still going"; stop the run first. A worktree whose folder is gone now shows as
`prune worktree` in the plan, and is dropped by its own path: clean no longer
runs `git worktree prune`, which dropped git's record of every missing worktree
in the repository, your own included. A branch a run created that you've since
checked out in a worktree of your own is left alone ("checked out in <path>"),
and that worktree is no longer taken for Ork's. The list's words read "2 commits
not merged" and "checked out in the main checkout".
