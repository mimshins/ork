---
"@krapht/ork": patch
---

A run no longer hangs when a loop runs out of rounds and the answer is to stop,
or when it's interrupted while that question is open, if the node had another
edge still to follow. It now ends with the reason.
