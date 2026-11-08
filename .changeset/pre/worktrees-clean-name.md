---
"@krapht/ork": patch
---

`ork worktrees clean <name>` now stops with an error that points to
`ork worktrees remove <name>`, instead of ignoring the name and saying "Nothing
to clean."
