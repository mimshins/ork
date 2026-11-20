---
"@krapht/ork": patch
---

`ork validate` warns (`verify.heavy`) when a worker a leader can spawn, or a
`forEach` node, has a `verify:` that runs one of the project's heavy commands,
since each copy queues for one of the machine's heavy slots.
