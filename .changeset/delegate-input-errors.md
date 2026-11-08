---
"@krapht/ork": patch
---

`delegate` and `spawn_worker` now offer a leader's own child ids as an enum, and
a wrong field or id is an error that names the field and the valid ids.
