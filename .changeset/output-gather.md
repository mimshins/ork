---
"@krapht/ork": patch
---

Add `output.gather` to keep a report's list fields across a node's rounds
instead of replacing them, so a gate reading a leader's decisions after a fix
loop sees every round's.
