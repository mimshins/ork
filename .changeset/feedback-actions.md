---
"@krapht/ork": patch
---

`ork feedback` and the browser view now follow one rule for what an item allows:
nothing on a dismissed item until you restore it, `accept` only on a new or
triaged one, `publish` only once, and no second `apply` while one is proposing a
fix for the item. A lesson added to an item that's resolved already leaves it
resolved.
