---
"@krapht/ork": patch
---

A `human.gate` in a run with no terminal (a pipe, a script, a background resume)
now waits for `ork decide` or the UI instead of being answered "no one" (or its
recommended option) on the spot. A resumed run's `continue` node now works in
the worktree a replayed read-only node used, rather than in a new worktree
without the run's change.
