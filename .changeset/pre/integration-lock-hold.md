---
"@krapht/ork": patch
---

A node's `lock` is now held. One run at a time on the machine holds a lock: a
`branch:<name>` lock is shared by every clone of the same origin. The run takes
it before the first node naming it and lets it go after the last one, or when
the run ends; a fanned node's items take it one at a time. A run that waits says
so in `ork ps`, `ork logs`, `ork tree` and the UI ("waiting for <lock>, held by
<run>/<node>"), and its timeouts don't count the wait. A resumed run that ended
holding a lock takes it again and reruns its locked nodes. `ork doctor` removes
the lock and check-slot records of processes that are gone.
