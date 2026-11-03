---
"@krapht/ork": patch
---

A workflow's first node can now loop back to itself with `maxRounds`, for a
simple retry. `ork validate` used to reject this with "no node can start".
