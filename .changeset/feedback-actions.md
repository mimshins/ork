---
"@krapht/ork": patch
---

`ork feedback` and the browser view now follow one rule for what an item allows:
nothing on a dismissed item until you restore it, `accept` only on a new or
triaged one, and `publish` only once. A lesson added to an item that's resolved
already leaves it resolved.
