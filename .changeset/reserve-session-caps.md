---
"@krapht/ork": patch
---

Sessions running together are no longer offered the same part of a run's
`limits.budgetUsd`: each sets its cap aside as it starts, so a run passes its
budget by at most the turn that crosses a session's cap
