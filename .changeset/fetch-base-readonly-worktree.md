---
"@krapht/ork": minor
---

A remote `git.base` such as `origin/main` is now fetched before a run starts
(`git.fetch: auto`, or `never` to skip it; a failed fetch stops the run), and
`git.readonly: base` makes a readonly node with no owner and no upstream
worktree read one shared worktree at the base instead of the checkout
