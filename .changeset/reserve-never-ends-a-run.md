---
"@krapht/ork": patch
---

A run ends `budget_exhausted` only when its budget is spent, not when a worker
hits a remainder that other sessions' reserves shrank, and a worker offered less
than its own cap now waits for a sibling worker's reserve to free instead of
starting on a sliver.
