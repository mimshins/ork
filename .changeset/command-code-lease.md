---
"@krapht/ork": patch
---

Add the Command Code MCP lease: a session's Ork endpoint is an `ork` entry in
its checkout's Command Code local scope, held one session per checkout (a second
waits, shown as a `session.waiting` event), and `ork doctor` removes an entry a
crashed session left, leaving the user's other entries as they were.
