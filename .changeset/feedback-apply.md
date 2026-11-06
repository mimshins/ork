---
"@krapht/ork": minor
---

`ork feedback apply <item>` has Ork propose a fix for a feedback item: it runs
Ork's own `ork:feedback-apply` workflow in the project the item came from, whose
worker can read and edit files but run no command, and Ork commits its change on
its own branch. Before you keep or discard it, you see what the branch changes
(`git diff --stat`) and how to read the whole of it. Ork never merges it.
