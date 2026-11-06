---
"@krapht/ork": minor
---

`ork feedback apply <item>` has Ork propose a fix for a feedback item: it runs
Ork's own `ork:feedback-apply` workflow in the project the item came from, whose
worker commits the smallest change that would stop the problem on its own
branch. You keep the branch, and the item is resolved, or discard it, and the
branch is removed. Ork never merges it.
