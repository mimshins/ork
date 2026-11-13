---
"@krapht/ork": patch
---

A failed `verify:` check always gets its retry. The resume that tells the
session what failed now gets at least 20 turns, even when the session used all
of its `maxTurns` before reporting; before, such a node failed at once with no
retry. Budgets still cap it, and `attempts` still bounds how often.
