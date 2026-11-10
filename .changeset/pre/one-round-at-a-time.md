---
"@krapht/ork": patch
---

A node fed by two edges no longer starts its second round while its first is
still running; the second waits for the first to finish.
