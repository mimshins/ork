---
"@krapht/ork": patch
---

A `forEach` item whose work can't be merged into its owner now fails the node
instead of passing, and `ork validate` refuses fanned nodes that would share one
worktree at once, could never run, or merge into an owner yet to run. Under
`commit: auto` with `merge: patch`, a child that runs again hands over only what
is new.
